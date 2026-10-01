"""The editorial timeline contract. No Hugging Face reads or browser dependencies."""
from __future__ import annotations

import calendar
import csv
import hashlib
import io
import re
from datetime import date
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit

import nh3

SCHEMA_VERSION = 1
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
DATE_COLUMNS = ("Year", "Month", "Day", "End Year", "End Month", "End Day")
STANDARD_COLUMNS = set(DATE_COLUMNS) | {
    "Time", "End Time", "Display Date", "Headline", "Text", "Media", "Media Credit",
    "Media Caption", "Media Thumbnail", "Type", "Group", "Background", "ID", "Media Alt",
}
CLEANER = nh3.Cleaner(
    tags={"a", "em", "i", "strong", "b", "blockquote", "p", "br", "ul", "ol", "li", "sup", "sub"},
    attributes={"a": {"href", "title"}}, url_schemes={"https", "http", "mailto"},
    url_relative=("rewrite_with_base", "https://islam.zmo.de/"),
)


class Fragment(HTMLParser):
    def __init__(self, value: str):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.links = []
        self.feed(value)

    def handle_data(self, value):
        self.text.append(value)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.append(dict(attrs).get("href", ""))


def plain(value: str) -> str:
    return " ".join(" ".join(Fragment(value).text).split())


def safe_url(value: str) -> str:
    value = unescape(value.strip())
    if not value:
        return ""
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username or parsed.password or re.search(r"[\x00-\x20\\]", value)):
        raise ValueError("Expected an absolute HTTP(S) media/source URL")
    # IWAC files already support HTTPS. Do not rewrite arbitrary external hosts.
    if parsed.hostname == "islam.zmo.de":
        value = urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, parsed.fragment))
    return value


def related_resources(*fragments: str) -> list[dict]:
    resources = set()
    for fragment in fragments:
        for link in Fragment(fragment).links:
            parsed = urlsplit(link)
            match = re.fullmatch(r"/s/[^/]+/(item|item-set)/(\d+)/?", parsed.path)
            if parsed.hostname == "islam.zmo.de" and match:
                resources.add((match[1], int(match[2])))
    return [{"type": kind, "id": number} for kind, number in sorted(resources)]


def clean_html(value: str, warnings: list[str], label: str) -> str:
    """Repair only the observed *trailing* opening-tag typo, then sanitise.

    Two opens, no closes, second open at end of text: the known sheet error.
    Anything ambiguous requires editorial review; HTML5 tree repair alone
    cannot infer where an author intended a quotation to end.
    """
    opens = list(re.finditer(r"<blockquote\s*>", value, re.I))
    closes = re.findall(r"</blockquote\s*>", value, re.I)
    if len(opens) == 2 and not closes and not value[opens[-1].end():].strip():
        value = value[:opens[-1].start()] + "</blockquote>"
        warnings.append(f"{label}: repaired trailing <blockquote> as </blockquote>")
    elif len(opens) != len(closes):
        raise ValueError(f"{label}: ambiguous blockquote markup; correct the source sheet")
    return CLEANER.clean(value)


def parse_date(row: dict, prefix: str = "") -> dict | None:
    parts = [row.get(prefix + key, "").strip() for key in ("Year", "Month", "Day")]
    if not any(parts):
        return None
    if not parts[0] or (parts[2] and not parts[1]):
        raise ValueError(f"{prefix}date has a day/month without its parent component")
    if any(p and not re.fullmatch(r"\d+", p) for p in parts):
        raise ValueError(f"{prefix}date components must be whole positive numbers")
    year, month, day = [int(p) if p else 1 for p in parts]
    date(year, month, day)  # Real calendar validation, including leap years.
    precision = "day" if parts[2] else "month" if parts[1] else "year"
    size = {"year": 4, "month": 7, "day": 10}[precision]
    return {"value": date(year, month, day).isoformat()[:size], "precision": precision}


def date_bound(value: dict, upper: bool = False) -> date:
    parts = [int(x) for x in value["value"].split("-")]
    year = parts[0]
    month = parts[1] if len(parts) > 1 else 12 if upper else 1
    day = parts[2] if len(parts) > 2 else calendar.monthrange(year, month)[1] if upper else 1
    return date(year, month, day)


def legacy_key(row: dict) -> str:
    """Match the frozen migration IDs without depending on row order or wording.

    An explicit ID column supersedes this map. Changes to a legacy match key
    require updating the map while retaining its ID; unknown keys fail loudly.
    """
    media = row.get("Media", "").strip()
    if media:
        return "media:" + safe_url(media)
    return "date:" + "|".join(row.get(key, "").strip() for key in DATE_COLUMNS)


def parse_csv(text: str, slug: str, locale: str, legacy_ids: dict | None = None) -> dict:
    if not IDENTIFIER.fullmatch(slug) or locale not in {"en", "fr"}:
        raise ValueError("Invalid timeline slug or locale")
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames or not {"Year", "Headline", "Text"}.issubset(reader.fieldnames):
        raise ValueError("Expected a TimelineJS CSV header, not a sign-in/error page")
    title = None
    events = []
    warnings = []
    ids = {"intro"}
    for row_number, raw in enumerate(reader, 2):
        if None in raw:
            raise ValueError(f"Row {row_number}: more cells than CSV headers")
        row = {key: (value or "").strip() for key, value in raw.items()}
        if not any(row.values()):
            continue
        try:
            unsupported = [key for key, value in row.items() if value and (
                key not in STANDARD_COLUMNS or key in {"Time", "End Time", "Group"})]
            if unsupported:
                raise ValueError("Unsupported populated columns: " + ", ".join(unsupported))
            start, end = parse_date(row), parse_date(row, "End ")
            is_intro = start is None and end is None and title is None and not events
            if not is_intro and start is None:
                raise ValueError("Only the opening introduction may be undated")
            if end and date_bound(end, True) < date_bound(start):
                raise ValueError("The end date precedes the start date")
            kind = row.get("Type", "").lower()
            if kind and kind != "title":
                raise ValueError(f"Unsupported slide Type: {kind}")
            if kind == "title" and not is_intro:
                warnings.append(f"Row {row_number}: dated Type=title retained as an event")
            if row.get("Background"):
                warnings.append(f"Row {row_number}: background override omitted; theme controls the surface")
            body = clean_html(row.get("Text", ""), warnings, f"Row {row_number} Text")
            caption = clean_html(row.get("Media Caption", ""), warnings, f"Row {row_number} Caption")
            credit = clean_html(row.get("Media Credit", ""), warnings, f"Row {row_number} Credit")
            media_url = safe_url(row.get("Media", ""))
            media = None
            if media_url:
                parsed = urlsplit(media_url)
                image = bool(re.search(r"\.(jpe?g|png|webp|gif)$", parsed.path, re.I))
                is_map = bool(re.fullmatch(r"(?:www\.)?google\.(?:com|ca|fr)", parsed.hostname or "")
                              and parsed.path.startswith("/maps"))
                media = {"type": "image" if image else "map" if is_map else "link",
                         "url": media_url, "thumbnail": safe_url(row.get("Media Thumbnail", "")),
                         "alt": plain(row.get("Media Alt", "")) or plain(caption),
                         "captionHtml": caption, "creditHtml": credit}
            identifier = "intro" if is_intro else row.get("ID") or (legacy_ids or {}).get(legacy_key(row))
            if not identifier or not IDENTIFIER.fullmatch(identifier):
                raise ValueError("Add a permanent lowercase ID column (or retain the ID in the legacy map)")
            if not is_intro and identifier in ids:
                raise ValueError(f"Duplicate/reserved event ID: {identifier}")
            ids.add(identifier)
            event = {"id": identifier, "start": start, "end": end,
                     "displayDate": plain(row.get("Display Date", "")),
                     "headline": plain(row.get("Headline", "")), "textHtml": body,
                     "media": media, "sourceOrder": len(events),
                     "relatedResources": related_resources(body, caption, credit)}
            if is_intro:
                if not event["headline"]:
                    raise ValueError("The introduction needs a headline")
                title = event
            else:
                if not event["headline"]:
                    warnings.append(f"Row {row_number}: empty headline; the viewer uses the date")
                events.append(event)
        except ValueError as exc:
            raise ValueError(f"{slug}/{locale} row {row_number}: {exc}") from exc
    if not title or not events:
        raise ValueError(f"{slug}/{locale}: expected an introduction and at least one dated event")
    return {"schemaVersion": SCHEMA_VERSION, "slug": slug, "locale": locale,
            "title": title, "events": events, "warnings": warnings}


def validate_timeline(payload: dict) -> None:
    """Validate before publishing *and* independently in the archive gate."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("Unsupported timeline schema")
    if not IDENTIFIER.fullmatch(str(payload.get("slug", ""))) or payload.get("locale") not in {"en", "fr"}:
        raise ValueError("Invalid timeline identity")
    title, events = payload.get("title"), payload.get("events")
    if not isinstance(title, dict) or title.get("id") != "intro" or not title.get("headline"):
        raise ValueError("Missing timeline introduction")
    if not isinstance(events, list) or not events:
        raise ValueError("Timeline has no events")
    ids = set()
    for event in [title] + events:
        if not isinstance(event, dict):
            raise ValueError("Timeline event must be an object")
        identifier = event.get("id", "")
        if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier) or identifier in ids:
            raise ValueError("Invalid/duplicate timeline event ID")
        ids.add(identifier)
        if identifier == "intro" and (event.get("start") or event.get("end")):
            raise ValueError("The introduction must be undated")
        for key in ("headline", "textHtml", "displayDate"):
            if not isinstance(event.get(key), str):
                raise ValueError(f"Missing event {key}")
        if type(event.get("sourceOrder")) is not int:
            raise ValueError("Missing authored event order")
        for key in ("start", "end"):
            value = event.get(key)
            if value is None:
                if key == "start" and identifier != "intro":
                    raise ValueError("Dated event has no start")
                continue
            precision = value.get("precision") if isinstance(value, dict) else None
            pattern = {"year": r"\d{4}", "month": r"\d{4}-\d{2}", "day": r"\d{4}-\d{2}-\d{2}"}.get(precision)
            if not pattern or not isinstance(value.get("value"), str) or not re.fullmatch(pattern, value["value"]):
                raise ValueError("Date value and precision disagree")
            date_bound(value)
        if event.get("end") and date_bound(event["end"], True) < date_bound(event["start"]):
            raise ValueError("Reversed timeline range")
        if CLEANER.clean(event["textHtml"]) != event["textHtml"]:
            raise ValueError("Timeline HTML has not been sanitised")
        media = event.get("media")
        if media:
            if not isinstance(media, dict) or media.get("type") not in {"image", "map", "link"} or not safe_url(media.get("url", "")):
                raise ValueError("Invalid timeline media")
            safe_url(media.get("thumbnail", ""))
            for key in ("captionHtml", "creditHtml"):
                if not isinstance(media.get(key), str) or CLEANER.clean(media[key]) != media[key]:
                    raise ValueError("Unsafe timeline caption/credit")
    source = payload.get("metadata", {}).get("source", {})
    if not re.fullmatch(r"[a-f0-9]{64}", source.get("sha256", "")) or not safe_url(source.get("url", "")):
        raise ValueError("Missing timeline source provenance")


def source_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()
