"""Rhetorical and stylistic analysis for the Albani Zaria sermons.

Bag-of-words counts, collocates, and topic lexicons measure *what* a preacher
talks about, not *how* they persuade: they flatten irony, humour, proverbs
(*karin magana*), voice-switching, and oral cadence. This module prototypes a
two-tier rhetorical layer that separates what can be measured directly in the
transcripts from tropes that require specialist review:

* **Tier 1 — Measurable schemes and register cues (deterministic):**
  - ``anaphora``: consecutive clauses/sentences in one turn opening with the
    same 2–4-word phrase (with at least one non-stopword content word).
  - ``vocative``: direct address to the audience (*ya ku*, *ya kai*, *ya ke*,
    *masu sauraro*, *mai saurare*, *ya 'yan uwa*, clause-initial *jama'a*).
  - ``rhetorical_question``: interrogative turns/clauses (*?*-terminated
    clauses of ≥3 words, or Hausa rhetorical question frames like *me ya sa*,
    *ko ba haka ba*, *shin*, *ta yaya*, *har yaushe*).
  - ``oath_emphasis``: oaths and certainty intensifiers (*wallahi*, *tallahi*,
    *billahi*, *babu shakka*, *lallai*, *haƙiƙa*, *dole ne*, *ko kaɗan*).
  - ``dialogue``: dramatised / reported dialogue bursts (*sai ya/ta/suka/aka
    ce*, or two or more quotatives within a short span).
  - ``code_switch``: Arabic citation bursts (≥2 consecutive ``ARABIC`` tokens)
    and English code-switching tokens from the layer classifier.

* **Tier 2 — Candidate tropes (surfaced for specialist review, never counted as
  validated rhetorical facts until reviewed):**
  - ``simile_exemplum``: similes, analogies, and historical exempla
    (*kamar yadda*, *kamar a ce*, *misali*, *wata rana*, *a zamanin*,
    *tarihi ya nuna*).
  - ``proverb_idiom``: explicit Hausa proverb cues (*karin magana*, *hausawa
    sukan ce*, *masu iya magana*, *maganar hausawa*).
  - ``polemic_irony``: polemical/ironic exclamation markers (*haba/habaa*,
    *ƙarya ne*, *tir*, *ina aka taɓa*, *wa ya gaya maka*).

The generator emits aggregate rates across all analysed recordings and
rights-gated KWIC excerpts (public transcripts only), and ``--style-review-sheet``
exports candidate passages to CSV for a Hausa-speaking specialist to accept,
relabel, or reject into ``rhetoric_annotations.json``.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from albani.layers import ARABIC, Resources, label_tokens
from albani.normalize import Token, fold, tokenize
from albani.transcript import window_label

ANNOTATIONS_PATH = Path(__file__).with_name("rhetoric_annotations.json")


@dataclass(frozen=True)
class DeviceSpec:
    id: str
    tier: int  # 1 = directly measurable scheme/cue; 2 = candidate trope for review
    label_en: str
    label_fr: str
    desc_en: str
    desc_fr: str


DEVICES: Tuple[DeviceSpec, ...] = (
    DeviceSpec(
        id="anaphora",
        tier=1,
        label_en="Anaphora & parallelism",
        label_fr="Anaphore et parallélisme",
        desc_en="Consecutive clauses opening with the same two- to four-word frame.",
        desc_fr="Propositions consécutives commençant par la même amorce de deux à quatre mots.",
    ),
    DeviceSpec(
        id="vocative",
        tier=1,
        label_en="Direct address",
        label_fr="Apostrophe directe",
        desc_en="Vocatives hailing the audience directly (ya ku, jama'a, 'yan uwa, masu sauraro).",
        desc_fr="Appels directs à l'auditoire (ya ku, jama'a, 'yan uwa, masu sauraro).",
    ),
    DeviceSpec(
        id="rhetorical_question",
        tier=1,
        label_en="Rhetorical questions",
        label_fr="Questions rhétoriques",
        desc_en="Questions and interrogative frames (me ya sa, ko ba haka ba, shin) used to press an argument.",
        desc_fr="Questions et tournures interrogatives (me ya sa, ko ba haka ba, shin) qui relancent l'argumentation.",
    ),
    DeviceSpec(
        id="oath_emphasis",
        tier=1,
        label_en="Oaths & emphasis",
        label_fr="Serments et emphase",
        desc_en="Oaths and certainty markers (wallahi, tallahi, lallai, babu shakka, dole ne) marking peaks of urgency.",
        desc_fr="Serments et marqueurs de certitude (wallahi, tallahi, lallai, babu shakka, dole ne) scandant les temps forts.",
    ),
    DeviceSpec(
        id="dialogue",
        tier=1,
        label_en="Dramatised dialogue",
        label_fr="Dialogue dramatisé",
        desc_en="Quotative sequences (sai ya ce, suka ce) staging mini-dialogues or voicing opponents and interlocutors.",
        desc_fr="Séquences de discours rapporté (sai ya ce, suka ce) mettant en scène des dialogues ou des adversaires.",
    ),
    DeviceSpec(
        id="code_switch",
        tier=1,
        label_en="Arabic & English switches",
        label_fr="Alternances arabe / anglais",
        desc_en="Arabic scriptural bursts and English academic/civic switches within Hausa exposition.",
        desc_fr="Séquences scripturaires arabes et emprunts discursifs anglais dans l'exposé haoussa.",
    ),
    DeviceSpec(
        id="simile_exemplum",
        tier=2,
        label_en="Similes & exempla",
        label_fr="Comparaisons et récits exemplaires",
        desc_en="Candidate analogies and narrative illustrations (kamar yadda, misali, wata rana) flagged for specialist review.",
        desc_fr="Candidats d'analogies et récits exemplaires (kamar yadda, misali, wata rana) soumis à validation.",
    ),
    DeviceSpec(
        id="proverb_idiom",
        tier=2,
        label_en="Proverb cues (karin magana)",
        label_fr="Indices proverbiaux (karin magana)",
        desc_en="Explicit proverbial frames (karin magana, hausawa sukan ce, masu iya magana) flagged for review.",
        desc_fr="Tournures proverbiales explicites (karin magana, hausawa sukan ce, masu iya magana) à valider.",
    ),
    DeviceSpec(
        id="polemic_irony",
        tier=2,
        label_en="Polemic & ironic cues",
        label_fr="Indices polémiques et ironiques",
        desc_en="Exclamations and rebuttals (haba, ƙarya ne, tir, ina aka taɓa) that often signal sarcasm or polemic — for review.",
        desc_fr="Exclamations et réfutations (haba, ƙarya ne, tir, ina aka taɓa) signalant souvent ironie ou polémique — à valider.",
    ),
)

DEVICE_BY_ID: Dict[str, DeviceSpec] = {d.id: d for d in DEVICES}
TIER1_IDS: Tuple[str, ...] = tuple(d.id for d in DEVICES if d.tier == 1)
TIER2_IDS: Tuple[str, ...] = tuple(d.id for d in DEVICES if d.tier == 2)


GENRES: Tuple[Dict[str, str], ...] = (
    {"id": "khutba", "label_en": "Friday sermons (khuṭba)", "label_fr": "Sermons du vendredi (khuṭba)"},
    {"id": "commentary", "label_en": "Textual lessons", "label_fr": "Cours de textes"},
    {"id": "lecture", "label_en": "Public lectures & wa'azi", "label_fr": "Conférences et wa'azi"},
    {"id": "interview", "label_en": "Interviews & debates", "label_fr": "Entretiens et débats"},
)


@dataclass(frozen=True)
class RhetoricHit:
    device: str
    tier: int
    char_start: int
    char_end: int
    trigger: str


# Clause splitter inside a turn: sentence punctuation or line breaks.
_CLAUSE_SPLIT_RE = re.compile(r"(?<=[.!?…;:])\s+|\n+")

# Direct-address vocative patterns (case-insensitive, matched on folded text).
_VOCATIVE_RE = re.compile(
    r"\b(?:"
    r"ya\s+ku(?:\s+(?:['’]?yan\s+uwa(?:nmu|na)?|musulmi|matasa|iyaye|malamai|jama['’]?a|bayin\s+allah))?"
    r"|yaku\s+(?:['’]?yan\s+uwa(?:nmu|na)?|musulmi|matasa|iyaye|malamai|jama['’]?a)"
    r"|ya\s+kai(?:\s+mai\s+saurar[eo]|\s+ɗan\s+uwa|\s+dan\s+uwa)?"
    r"|ya\s+ke\b"
    r"|masu\s+saurar[eo]"
    r"|mai\s+saurar[eo]"
    r"|ku\s+['’]?yan\s+uwa(?:nmu|na)?"
    r"|bayin\s+allah"
    r"|(?:^|[.!?,;:]\s+|(?:toh?|wallahi|ku\s+sani)\s+)jama['’]?a(?![rn]\b)"
    r")\b",
    re.IGNORECASE,
)

# Rhetorical-question lexical frames (in addition to '?' clauses).
_RHET_Q_FRAME_RE = re.compile(
    r"\b(?:"
    r"me\s+ya\s+sa|meyasa|ko\s+ba\s+haka\s+ba|shin\b|ta\s+yaya|yaya\s+za\s*a|har\s+yaushe|ina\s+ruwan"
    r")\b",
    re.IGNORECASE,
)

# Oaths and certainty intensifiers.
_OATH_RE = re.compile(
    r"\b(?:"
    r"wallahi(?:\s+tallahi(?:\s+billahi)?)?"
    r"|tallahi|billahi"
    r"|babu\s+shakka|ba\s+shakka"
    r"|lallai(?:\s+ne)?"
    r"|ha[kƙ]i[kƙ]a"
    r"|dole\s+ne"
    r"|ko\s+ka[dɗ]an"
    r")\b",
    re.IGNORECASE,
)

# Dramatised / reported dialogue bursts.
_DIALOGUE_EXPLICIT_RE = re.compile(
    r"\b(?:"
    r"sai\s+(?:ya|ta|na|ka|ki|mu|ku|su|suka|muka|kuka|aka)\s+ce"
    r"|sai\s+(?:yace|tace|nace|kace|sukace|mukace|akace)"
    r"|(?:ya|ta|suka|muka|aka)\s+ce\s+(?:masa|mata|musu|mashi|mini|maka)"
    r"|(?:yana|tana|suna|yake|take|suke)\s+cewa"
    r")\b",
    re.IGNORECASE,
)
_QUOTATIVE_RE = re.compile(
    r"\b(?:(?:ya|ta|na|ka|suka|muka|aka)\s+ce|yace|tace|nace|kace|sukace|mukace|akace)\b",
    re.IGNORECASE,
)

# Tier 2 candidate tropes (for specialist review).
_SIMILE_RE = re.compile(
    r"\b(?:"
    r"kama[rn]\s+(?:yadda|a\s+ce|ace)"
    r"|(?:a\s+)?misali\b"
    r"|wata\s+rana\b"
    r"|a\s+zamanin\b"
    r"|tarihi\s+ya\s+nuna"
    r")\b",
    re.IGNORECASE,
)

_PROVERB_RE = re.compile(
    r"\b(?:"
    r"karin\s+magana"
    r"|hausawa\s+(?:sukan|sun|suke)\s+ce"
    r"|masu\s+iya\s+magana"
    r"|maganar\s+hausawa"
    r"|karen\s+bana"
    r"|in\s+an\s+bugi\s+jaki"
    r")\b",
    re.IGNORECASE,
)

_POLEMIC_RE = re.compile(
    r"\b(?:"
    r"haba+(?:\s+\w+)?"
    r"|[kƙ]arya\s+ne"
    r"|tir\s+da\b"
    r"|ina\s+aka\s+ta[bɓ]a"
    r"|wa\s+ya\s+gaya\s+ma(?:ka|su|ku)"
    r")\b",
    re.IGNORECASE,
)

# Genre heuristics from recording title (transparent, overridable).
_GENRE_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("khutba", re.compile(r"\bkhudub|khutb|juma'?a\b", re.IGNORECASE)),
    ("interview", re.compile(r"\bhirar\b|d\.?i\.?t?\.?v|tambay|ina\s+gaskiyar|radio|tattaunawa", re.IGNORECASE)),
    ("commentary", re.compile(
        r"\b(?:bukhar|bukhaari|muslim|adabul\s+mufrad|dariqus|riyad|tafsir|hadis|hadith|sahih|karatuttukan|kitab)\b",
        re.IGNORECASE,
    )),
)


def classify_genre(title: str) -> str:
    """Heuristically group a recording into one of four preaching genres."""
    for genre, pattern in _GENRE_PATTERNS:
        if pattern.search(title or ""):
            return genre
    return "lecture"


def load_annotations(path: Path = ANNOTATIONS_PATH) -> Dict[str, Any]:
    """Load specialist-validated rhetorical annotations (ships empty as draft)."""
    if not path.exists():
        return {"status": "draft", "annotations": []}
    raw = json.loads(path.read_text(encoding="utf-8"))
    annotations = raw.get("annotations") or []
    status = str(raw.get("status") or ("validated" if annotations else "draft"))
    return {"status": status, "annotations": list(annotations)}


def _detect_anaphora(text: str, stopwords: frozenset[str]) -> List[RhetoricHit]:
    """Find consecutive clauses in a turn opening with the same 2–4-word frame."""
    clauses: List[Tuple[int, int, List[Token]]] = []
    pos = 0
    for match in _CLAUSE_SPLIT_RE.finditer(text):
        seg = text[pos:match.start()]
        if seg.strip():
            toks = tokenize(seg)
            if len(toks) >= 3:
                clauses.append((pos, match.start(), toks))
        pos = match.end()
    tail = text[pos:]
    if tail.strip():
        toks = tokenize(tail)
        if len(toks) >= 3:
            clauses.append((pos, len(text), toks))

    if len(clauses) < 2:
        return []

    hits: List[RhetoricHit] = []
    i = 0
    while i < len(clauses) - 1:
        best_len = 0
        best_end_idx = i
        _, _, t0 = clauses[i]
        keys0 = [t.key for t in t0[:4]]

        for prefix_len in (4, 3, 2):
            if len(keys0) < prefix_len:
                continue
            prefix = tuple(keys0[:prefix_len])
            # Require at least one non-stopword content token so bare
            # "to sai ... to sai ..." or "da aka ... da aka ..." is ignored.
            if not any(k and k not in stopwords and len(k) >= 3 for k in prefix):
                continue
            j = i + 1
            while j < len(clauses):
                _, _, tj = clauses[j]
                if len(tj) < prefix_len:
                    break
                if tuple(t.key for t in tj[:prefix_len]) == prefix:
                    j += 1
                else:
                    break
            if j - i >= 2:
                best_len = prefix_len
                best_end_idx = j - 1
                break

        if best_len:
            c_start = clauses[i][0] + clauses[i][2][0].start
            last_clause = clauses[best_end_idx]
            c_end = last_clause[0] + last_clause[2][min(len(last_clause[2]) - 1, best_len + 2)].end
            trigger = " ".join(t.surface for t in t0[:best_len])
            hits.append(RhetoricHit(
                device="anaphora",
                tier=1,
                char_start=c_start,
                char_end=min(len(text), c_end),
                trigger=trigger,
            ))
            i = best_end_idx + 1
        else:
            i += 1
    return hits


def _detect_questions(text: str) -> List[RhetoricHit]:
    """Detect '?' interrogatives (≥3 words) and Hausa rhetorical-question frames."""
    hits: List[RhetoricHit] = []
    covered: List[Tuple[int, int]] = []

    # 1. Clauses ending with a question mark (at least 3 tokens).
    for m in re.finditer(r"[^.!?\n]{6,}\?", text):
        chunk = m.group(0).strip()
        toks = tokenize(chunk)
        if len(toks) < 3:
            continue
        start = m.start() + (len(m.group(0)) - len(m.group(0).lstrip()))
        end = m.end()
        hits.append(RhetoricHit("rhetorical_question", 1, start, end, "?"))
        covered.append((start, end))

    # 2. Explicit Hausa rhetorical-question frames not already inside a '?' span.
    for m in _RHET_Q_FRAME_RE.finditer(text):
        if any(s <= m.start() and m.end() <= e for s, e in covered):
            continue
        hits.append(RhetoricHit("rhetorical_question", 1, m.start(), m.end(), fold(m.group(0))))
    return hits


def _detect_dialogue(text: str) -> List[RhetoricHit]:
    """Detect dramatised dialogue (explicit sai-quotatives or clustered quotatives)."""
    hits: List[RhetoricHit] = []
    covered: List[Tuple[int, int]] = []

    for m in _DIALOGUE_EXPLICIT_RE.finditer(text):
        hits.append(RhetoricHit("dialogue", 1, m.start(), m.end(), fold(m.group(0))))
        covered.append((m.start(), m.end()))

    # Also catch rapid back-and-forth quotatives (≥2 within 140 chars) not already covered.
    quots = [m for m in _QUOTATIVE_RE.finditer(text)
             if not any(s <= m.start() and m.end() <= e for s, e in covered)]
    i = 0
    while i < len(quots) - 1:
        if quots[i + 1].start() - quots[i].end() <= 140:
            j = i + 1
            while j + 1 < len(quots) and quots[j + 1].start() - quots[j].end() <= 140:
                j += 1
            hits.append(RhetoricHit("dialogue", 1, quots[i].start(), quots[j].end(), "dialogue-turn"))
            i = j + 1
        else:
            i += 1
    return hits


def _detect_code_switches(
    tokens: Sequence[Token],
    labels: Sequence[str],
    res: Resources,
    base_offset: int = 0,
) -> Tuple[List[RhetoricHit], int, int]:
    """Find contiguous Arabic citation bursts (≥2 tokens) and English switches."""
    hits: List[RhetoricHit] = []
    ar_bursts = 0
    en_switches = 0

    i = 0
    n = len(tokens)
    while i < n:
        if labels[i] == ARABIC:
            j = i + 1
            while j < n and labels[j] == ARABIC:
                j += 1
            if j - i >= 2:
                ar_bursts += 1
                hits.append(RhetoricHit(
                    "code_switch", 1,
                    max(0, tokens[i].start - base_offset),
                    max(0, tokens[j - 1].end - base_offset),
                    "arabic-burst",
                ))
            i = j
            continue
        if tokens[i].key in res.english and len(tokens[i].surface) >= 4:
            j = i + 1
            while j < n and tokens[j].key in res.english:
                j += 1
            en_switches += 1
            hits.append(RhetoricHit(
                "code_switch", 1,
                max(0, tokens[i].start - base_offset),
                max(0, tokens[j - 1].end - base_offset),
                "english-switch",
            ))
            i = j
            continue
        i += 1
    return hits, ar_bursts, en_switches


def _regex_hits(text: str, pattern: re.Pattern[str], device: str, tier: int) -> List[RhetoricHit]:
    hits: List[RhetoricHit] = []
    for m in pattern.finditer(text):
        span = m.group(0)
        # Trim leading punctuation/whitespace from clause-initial patterns (e.g. ". jama'a").
        trimmed = span.lstrip(" \t\r\n.,!?;:")
        offset = len(span) - len(trimmed)
        start = m.start() + offset
        end = m.end()
        if start < end:
            hits.append(RhetoricHit(device, tier, start, end, fold(trimmed)))
    return hits


def analyze_turn(
    text: str,
    res: Resources,
    tokens: Optional[Sequence[Token]] = None,
    labels: Optional[Sequence[str]] = None,
    base_offset: int = 0,
) -> Tuple[List[RhetoricHit], int, int]:
    """Run Tier 1 + Tier 2 rhetorical detectors on a single speaker turn."""
    if not text or not text.strip():
        return [], 0, 0
    if tokens is None:
        tokens = tokenize(text)
        base_offset = 0
    if labels is None:
        labels = label_tokens(tokens)

    hits: List[RhetoricHit] = []
    hits.extend(_detect_anaphora(text, res.hausa_stop))
    hits.extend(_regex_hits(text, _VOCATIVE_RE, "vocative", 1))
    hits.extend(_detect_questions(text))
    hits.extend(_regex_hits(text, _OATH_RE, "oath_emphasis", 1))
    hits.extend(_detect_dialogue(text))
    sw_hits, ar_bursts, en_switches = _detect_code_switches(tokens, labels, res, base_offset)
    hits.extend(sw_hits)

    # Tier 2 candidate tropes (for specialist review).
    hits.extend(_regex_hits(text, _SIMILE_RE, "simile_exemplum", 2))
    hits.extend(_regex_hits(text, _PROVERB_RE, "proverb_idiom", 2))
    hits.extend(_regex_hits(text, _POLEMIC_RE, "polemic_irony", 2))

    hits.sort(key=lambda h: (h.char_start, h.char_end, h.device))
    return hits, ar_bursts, en_switches


def _kwic_slice(text: str, start: int, end: int, context_chars: int = 130) -> Tuple[str, str, str]:
    """Word-aligned left / match / right strings around a character span."""
    l_from = max(0, start - context_chars)
    if l_from > 0:
        space = text.find(" ", l_from, start)
        if space != -1:
            l_from = space + 1
    r_to = min(len(text), end + context_chars)
    if r_to < len(text):
        space = text.rfind(" ", end, r_to)
        if space != -1:
            r_to = space
    left = re.sub(r"\s+", " ", text[l_from:start]).lstrip()
    match = re.sub(r"\s+", " ", text[start:end]).strip()
    right = re.sub(r"\s+", " ", text[end:r_to]).rstrip()
    return left, match, right


def _spread_rows(candidates: List[Dict[str, Any]], cap: int) -> List[Dict[str, Any]]:
    """Round-robin across recordings so one long sermon never crowds out the rest."""
    by_rec: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in candidates:
        by_rec[row["_o"]].append(row)
    order = sorted(by_rec, key=lambda o: (0, int(o)) if o.isdigit() else (1, o))
    out: List[Dict[str, Any]] = []
    idx = 0
    while len(out) < cap:
        progressed = False
        for oid in order:
            bucket = by_rec[oid]
            if idx < len(bucket):
                out.append(bucket[idx])
                progressed = True
                if len(out) >= cap:
                    break
        if not progressed:
            break
        idx += 1
    return out


def build_rhetoric_bundle(
    recs: Sequence[Any],
    res: Resources,
    *,
    generated_at: str,
    per_device_cap: int = 60,
    context_chars: int = 130,
    annotations_path: Path = ANNOTATIONS_PATH,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Build the ``rhetoric.json`` payload and the full public review-sheet rows.

    Returns ``(bundle, review_rows)`` where ``review_rows`` contains public
    passages suitable for ``--style-review-sheet`` export.
    """
    ann_data = load_annotations(annotations_path)
    validated_raw = ann_data["annotations"]

    item_index: Dict[str, int] = {}
    items: List[Dict[str, Any]] = []
    public_ids: set[str] = set()

    def item_slot(rec: Any) -> int:
        if rec.o_id not in item_index:
            item_index[rec.o_id] = len(items)
            items.append({
                "o": rec.o_id,
                "t": rec.title,
                "u": rec.url,
                "y": rec.year,
                "m": rec.media,
            })
        return item_index[rec.o_id]

    for rec in recs:
        if rec.public:
            public_ids.add(rec.o_id)

    scopes_out: Dict[str, Any] = {}
    # Collect per-device passage candidates once (on "all" scope; rows carry "md"
    # so the UI filters monologue cleanly without duplicating rows).
    by_device_candidates: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    found_counts: Counter[str] = Counter()
    withheld_counts: Counter[str] = Counter()
    review_rows: List[Dict[str, Any]] = []

    # Pre-scan every analysed segment once so both scopes reuse the exact hits.
    segment_scans: List[Tuple[Any, Any, int, Counter[str], int, int, int]] = []
    for rec in recs:
        k = 0
        for seg in rec.segments:
            if not seg.counted:
                continue
            seg_counts: Counter[str] = Counter()
            seg_ar_bursts = 0
            seg_ar_tokens = 0
            seg_en = 0
            meta_seg = seg.segment
            for turn in seg.turns:
                turn_text = rec.text[turn.start:turn.end]
                seg_ar_tokens += sum(1 for lab in turn.labels if lab == ARABIC)
                hits, ar_b, en_s = analyze_turn(
                    turn_text, res, turn.tokens, turn.labels, base_offset=turn.start,
                )
                seg_ar_bursts += ar_b
                seg_en += en_s
                for h in hits:
                    seg_counts[h.device] += 1
                    found_counts[h.device] += 1
                    if not rec.public:
                        withheld_counts[h.device] += 1
                        continue
                    left, match, right = _kwic_slice(turn_text, h.char_start, h.char_end, context_chars)
                    if not match:
                        continue
                    row = {
                        "_o": rec.o_id,
                        "d": h.device,
                        "tier": h.tier,
                        "tr": h.trigger,
                        "p": meta_seg.ordinal,
                        "w": meta_seg.index,
                        "of": meta_seg.total,
                        "s": meta_seg.start_seconds,
                        "md": seg.mode,
                        "l": left,
                        "m": match,
                        "r": right,
                        "i": item_slot(rec),
                    }
                    by_device_candidates[h.device].append(row)
                    review_rows.append({
                        "recording_id": rec.o_id,
                        "title": rec.title,
                        "year": rec.year or "",
                        "part": meta_seg.ordinal,
                        "window": window_label(meta_seg),
                        "mode": seg.mode,
                        "tier": h.tier,
                        "device": h.device,
                        "trigger": h.trigger,
                        "left_context": left,
                        "matched_text": match,
                        "right_context": right,
                    })
            segment_scans.append((rec, seg, k, seg_counts, seg_ar_bursts, seg_ar_tokens, seg_en))
            k += 1

    # Aggregate per scope ("all" and "monologue").
    for scope in ("all", "monologue"):
        totals: Counter[str] = Counter()
        rec_words: Counter[str] = Counter()
        rec_counts: Dict[str, Counter[str]] = defaultdict(Counter)
        rec_ar_tokens: Counter[str] = Counter()
        rec_en_switches: Counter[str] = Counter()
        grid: List[Dict[str, Any]] = []

        for rec, seg, k, seg_counts, seg_ar_bursts, seg_ar_tokens, seg_en in segment_scans:
            if scope == "monologue" and seg.mode != "monologue":
                continue
            meta_seg = seg.segment
            w_seg = seg.n_tokens
            rec_words[rec.o_id] += w_seg
            rec_ar_tokens[rec.o_id] += seg_ar_tokens
            rec_en_switches[rec.o_id] += seg_en
            for dev_id, cnt in seg_counts.items():
                totals[dev_id] += cnt
                rec_counts[rec.o_id][dev_id] += cnt
            grid.append({
                "o": rec.o_id,
                "k": k,
                "p": meta_seg.ordinal,
                "s": meta_seg.start_seconds,
                "e": meta_seg.end_seconds,
                "md": seg.mode,
                "w": w_seg,
                "d": {dev_id: seg_counts[dev_id] for dev_id in TIER1_IDS if seg_counts[dev_id]},
                "ar": seg_ar_bursts,
                "en": seg_en,
            })

        by_recording: List[Dict[str, Any]] = []
        genre_words: Counter[str] = Counter()
        genre_recs: Counter[str] = Counter()
        genre_counts: Dict[str, Counter[str]] = defaultdict(Counter)

        for rec in recs:
            w = rec_words[rec.o_id]
            genre = classify_genre(rec.title)
            counts_map = {dev.id: rec_counts[rec.o_id][dev.id] for dev in DEVICES}
            rates_map = {
                dev.id: round(counts_map[dev.id] / w * 10000, 2) if w else 0.0
                for dev in DEVICES
            }
            by_recording.append({
                "o": rec.o_id,
                "w": w,
                "genre": genre,
                "counts": counts_map,
                "rates": rates_map,
                "ar_pct": round(rec_ar_tokens[rec.o_id] / w * 100, 2) if w else 0.0,
                "en_rate": round(rec_en_switches[rec.o_id] / w * 10000, 2) if w else 0.0,
            })
            if w > 0:
                genre_words[genre] += w
                genre_recs[genre] += 1
                for dev in DEVICES:
                    genre_counts[genre][dev.id] += counts_map[dev.id]

        by_genre: List[Dict[str, Any]] = []
        for g in GENRES:
            gid = g["id"]
            gw = genre_words[gid]
            if not genre_recs[gid]:
                continue
            by_genre.append({
                "genre": gid,
                "recordings": genre_recs[gid],
                "words": gw,
                "counts": {dev.id: genre_counts[gid][dev.id] for dev in DEVICES},
                "rates": {
                    dev.id: round(genre_counts[gid][dev.id] / gw * 10000, 2) if gw else 0.0
                    for dev in DEVICES
                },
            })

        scopes_out[scope] = {
            "totals": {dev.id: totals[dev.id] for dev in DEVICES},
            "by_recording": by_recording,
            "by_genre": by_genre,
            "grid": grid,
        }

    # Build rights-gated passages table (spread evenly per device across recordings).
    rows_out: List[Dict[str, Any]] = []
    counts_out: Dict[str, Dict[str, int]] = {}
    for dev in DEVICES:
        picked = _spread_rows(by_device_candidates.get(dev.id, []), per_device_cap)
        for row in picked:
            clean = {k: v for k, v in row.items() if k != "_o"}
            rows_out.append(clean)
        counts_out[dev.id] = {
            "found": found_counts[dev.id],
            "withheld": withheld_counts[dev.id],
            "emitted": len(picked),
        }

    # Rights-gate specialist-validated annotations: quotes only for public recordings.
    validated_out: List[Dict[str, Any]] = []
    for ann in validated_raw:
        oid = str(ann.get("o") or "")
        entry = {
            "o": oid,
            "part": int(ann.get("part") or 1),
            "start_s": int(ann.get("start_s") or 0),
            "device": str(ann.get("device") or ""),
            "note_en": str(ann.get("note_en") or ""),
            "note_fr": str(ann.get("note_fr") or ""),
        }
        if oid in public_ids and ann.get("quote"):
            entry["quote"] = str(ann["quote"])
        validated_out.append(entry)

    bundle = {
        "generated_at": generated_at,
        "status": "prototype",
        "annotations_status": ann_data["status"],
        "per_device_cap": per_device_cap,
        "devices": [
            {
                "id": d.id,
                "tier": d.tier,
                "label_en": d.label_en,
                "label_fr": d.label_fr,
                "desc_en": d.desc_en,
                "desc_fr": d.desc_fr,
            }
            for d in DEVICES
        ],
        "genres": list(GENRES),
        "scopes": scopes_out,
        "passages": {
            "items": items,
            "rows": rows_out,
            "counts": counts_out,
            "validated": validated_out,
        },
    }
    return bundle, review_rows


def write_style_review_sheet(review_rows: Sequence[Dict[str, Any]], path: Path) -> None:
    """Write candidate rhetorical passages (public transcripts only) to CSV for review."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "recording_id", "title", "year", "part", "window", "mode",
        "tier", "device", "trigger", "left_context", "matched_text", "right_context",
        "verdict", "revised_device", "analyst_note",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in review_rows:
            writer.writerow({**row, "verdict": "", "revised_device": "", "analyst_note": ""})
