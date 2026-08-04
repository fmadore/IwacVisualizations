#!/usr/bin/env python3
"""
generate_laicite.py
===================

Generate the JSON bundles consumed by the IwacVisualizations "Laïcité" page
block (GitHub issue #14) — a dossier on secularism in the IWAC corpus:

    asset/data/laicite-metadata.json      # KPIs, tag-vs-text Venn, rights split
    asset/data/laicite-trends.json        # per-year series, global/country/frame
    asset/data/laicite-countries.json     # per-country aggregates
    asset/data/laicite-documents.json     # the primary-source dossier
    asset/data/laicite-concordance.json   # KWIC rows — RIGHTS-GATED (see below)

The hand-curated event annotations for the timeline live in
``asset/data/laicite-events.json`` — a committed file (gitignore exception,
like ``scary-terms-events.json``) that this generator does NOT write; it
rides into the CI data archive from the checkout.

Why this is not "Scary Terms with a different word list"
--------------------------------------------------------
Scary Terms answers "how often do these twelve words appear?". This block
answers "how is one contested political concept argued about, by whom, in
which arenas, over sixty years — and let me read the actual sentences."
Three consequences shape the code:

1. **The concept has a curated authority record** (``index`` o:id 5,
   *Laïcité*), so the dossier is defined by the tag *and* the text, and the
   divergence between them is surfaced rather than smoothed away.
2. **It scans four subsets, not one.** ``articles`` (press coverage),
   ``publications`` (Islamic periodicals), ``documents`` (primary sources)
   and ``references`` (scholarship) are different evidentiary objects, so
   every record carries a ``subset`` discriminator and **no bundle sums
   across subsets without labelling it**.
3. **It matches RAW text, not ``lemma_text``.** Scary Terms counts against
   the lemma column; that is the one recipe here that must not be ported.
   The concordance is built on character offsets into readable text with
   original casing and diacritics, and multi-word patterns (*séparation de
   l'État et*, *code des personnes et de la famille*) do not survive
   lemmatization predictably. Matching folds accents on both sides so the
   frequent OCR spelling ``laicite`` is caught alongside ``laïcité``.
   (``documents`` gained ``lemma_text`` / ``lemma_nostop`` upstream on
   2026-08-04, so the lemma columns now exist on every subset scanned here —
   that removed a third reason for this choice but not the two above.)

Membership rule (load-bearing)
-------------------------------
An item joins the dossier when it carries the subject tag *Laïcité* **or**
when its text matches one of the ``membership_frames`` in the lexicon
sidecar. Every other frame is an annotation computed *within* members,
never a membership criterion — widening membership to, say, ``ecole``
would pull in every education article ever written, and the arenas view
would silently measure schooling coverage instead of the laïcité contest
over schooling.

The ``laïc`` / ``laïque`` trap
-------------------------------
In a corpus with heavy Catholic press coverage those forms also mean "lay
person" (the laity, as opposed to the clergy). Unlike the ``fondamental``
exclusion in ``generate_scary_terms.py``, this cannot be fixed by an
exclusion list: the *same* surface form carries both senses. Each ambiguous
occurrence is therefore classified by a narrow window (immediate qualifier
within ±2 tokens, else a ±8-token neighbourhood vote). Laity-classified
occurrences are counted and reported but do not contribute to frame counts
and never seed membership on their own. The counts are logged and written
into the metadata bundle so the decision stays auditable; the word lists
live in ``scripts/laicite_lexicon.json`` so it stays tunable without a code
change.

Privacy — the rights gate
--------------------------
This script reads the **private** full mirror where ``OCR`` is populated for
every row regardless of source visibility, and the bundles are served
publicly from ``files/iwac-visualizations/``. So a KWIC snippet cut from
``OCR`` is emitted **only** when the row's ``OCR_is_public`` flag is true —
the same per-value gate ``publish_public.py`` applies, and the identical
constraint ``generate_on_this_day.py`` documents. Never relax it.

The gate is applied **per source field, not per item**: ``title``,
``descriptionAI``, ``abstract`` and ``tableOfContents`` are public columns,
so a match in one of them is quotable even when the same item's ``OCR`` is
not. Aggregate counts are computed over all text (derived statistics, no
verbatim reproduction); only the readable snippets are gated. The two
denominators differ and the metadata bundle carries both, **per subset**,
because the split is wildly uneven (documents 25/26 public, publications
1298/1501, articles 7549/12356, references 7/867) and one global percentage
would imply an evenness that does not exist.

Usage
-----
    python scripts/generate_laicite.py
    python scripts/generate_laicite.py --output-dir asset/data --minify
    python scripts/generate_laicite.py --max-snippets 8000 -v

Environment
-----------
    HF_TOKEN    Hugging Face access token — required, the default dataset is
                the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    add_standard_args,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    normalize_country,
    parse_pipe_separated,
    parse_standard_args,
    save_json,
)

LEXICON_PATH = Path(__file__).with_name("laicite_lexicon.json")

# Per-subset text fields, in scan order: (column, is_public_column).
# `is_public_column` False means the field is `OCR` and rides the rights
# gate; True means the column is public on the Hub and is always quotable.
SUBSET_FIELDS: Dict[str, List[Tuple[str, bool]]] = {
    "articles":     [("title", True), ("descriptionAI", True), ("OCR", False)],
    "publications": [("title", True), ("tableOfContents", True), ("OCR", False)],
    "documents":    [("title", True), ("descriptionAI", True), ("OCR", False)],
    "references":   [("title", True), ("abstract", True), ("OCR", False)],
}

# Columns pulled per subset. Deliberately narrow: the 768-dim embedding
# columns and the sentiment justifications are never materialized (the
# pandas conversion, not the download, is where the memory goes).
SUBSET_COLUMNS: Dict[str, List[str]] = {
    "articles": [
        "o:id", "title", "newspaper", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "descriptionAI", "iwac_url",
    ],
    "publications": [
        "o:id", "title", "newspaper", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "tableOfContents", "iwac_url",
    ],
    "documents": [
        "o:id", "title", "author", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "descriptionAI", "iwac_url",
        "type", "nb_pages",
    ],
    "references": [
        "o:id", "title", "author", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "abstract", "iwac_url",
        "o:resource_class",
    ],
}

# Per-item snippet caps, by subset. Primary sources are uncapped (26 items,
# the densest and most quotable material in the collection); a periodical
# issue is a whole magazine so it earns more lines than a single article.
PER_ITEM_SNIPPET_CAP: Dict[str, Optional[int]] = {
    "documents": None,
    "publications": 12,
    "articles": 6,
    "references": 4,
}

SNIPPET_CONTEXT = 120   # characters either side of the match
TOKEN_RE = re.compile(r"[a-z]+")


# =============================================================================
# Accent folding that preserves character offsets
# =============================================================================

def fold_preserving(text: str) -> str:
    """Lowercase + strip diacritics, mapping each input char to exactly one
    output char so offsets into the folded string index the original.

    ``str.lower()`` plus a plain NFD-normalize-and-strip would be shorter,
    but NFD changes string length (``é`` → ``e`` + U+0301), and on
    already-decomposed input the strip changes it again. Character offsets
    are what the concordance is built on, so the mapping has to be 1:1.
    """
    out: List[str] = []
    for ch in text:
        decomposed = unicodedata.normalize("NFD", ch)
        base = decomposed[0] if decomposed else ch
        out.append(base.lower())
    return "".join(out)


def fold_plain(text: str) -> str:
    """Offset-agnostic fold, for lexicon terms and tag comparisons."""
    if not isinstance(text, str):
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )


# =============================================================================
# Lexicon
# =============================================================================

def _form_to_pattern(form: str) -> str:
    """Compile one curated surface form into a regex fragment.

    Multi-word forms match across flexible whitespace, and an elided
    article (``l'État``) also matches the OCR spelling that drops the
    apostrophe (``l Etat``).
    """
    folded = fold_plain(form)
    parts = re.split(r"[\s']+", folded)
    parts = [re.escape(p) for p in parts if p]
    return r"[\s']+".join(parts)


class Lexicon:
    """The curated frame lexicon plus the laity/state disambiguator."""

    def __init__(self, path: Path = LEXICON_PATH):
        with path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
        self.raw = raw
        self.frames: Dict[str, Dict[str, Any]] = raw["frames"]
        self.membership_frames: List[str] = list(raw["membership_frames"])
        self.authority: Dict[str, Any] = raw.get("authority", {})

        self.patterns: Dict[str, re.Pattern] = {}
        for name, spec in self.frames.items():
            # Longest first so "état laïc" wins over the bare "laïc" at the
            # same position; the scan takes non-overlapping matches.
            forms = sorted(spec["forms"], key=len, reverse=True)
            alternation = "|".join(_form_to_pattern(f) for f in forms)
            self.patterns[name] = re.compile(r"\b(?:" + alternation + r")\b")

        # Ambiguous forms, per frame, as folded whole tokens.
        self.ambiguous: Dict[str, Set[str]] = {
            name: {fold_plain(f) for f in spec.get("ambiguous", [])}
            for name, spec in self.frames.items()
        }

        d = raw["disambiguation"]
        self.state_left = {fold_plain(w) for w in d["state_left"]}
        self.state_right = {fold_plain(w) for w in d["state_right"]}
        self.laity_left = {fold_plain(w) for w in d["laity_left"]}
        self.laity_bare_plural_left = {
            fold_plain(w) for w in d["laity_bare_plural_left"]
        }
        self.laity_near = {fold_plain(w) for w in d["laity_near"]}
        self.state_near = {fold_plain(w) for w in d["state_near"]}

    def frame_labels(self) -> Dict[str, Dict[str, str]]:
        return {
            name: {
                "en": spec.get("label_en", name),
                "fr": spec.get("label_fr", name),
                "note": spec.get("note", ""),
            }
            for name, spec in self.frames.items()
        }

    # -- disambiguation ---------------------------------------------------

    def classify_ambiguous(self, tokens: Sequence[str], idx: int) -> str:
        """Return ``'state'`` or ``'laity'`` for an ambiguous hit.

        An immediate qualifier decides when one is present; otherwise a
        narrow neighbourhood vote does, defaulting to ``state`` on a tie
        (the dossier's own concept is the more likely reading inside a
        corpus already filtered to it).
        """
        token = tokens[idx]
        if token == "laicat":          # the body of lay people, never the principle
            return "laity"

        left1 = tokens[idx - 1] if idx >= 1 else ""
        left2 = tokens[idx - 2] if idx >= 2 else ""
        right1 = tokens[idx + 1] if idx + 1 < len(tokens) else ""
        right2 = tokens[idx + 2] if idx + 2 < len(tokens) else ""

        if left1 in self.state_left or left2 in self.state_left:
            return "state"
        if left1 in self.laity_left or left2 in self.laity_left:
            return "laity"
        # "des laïcs" / "les laïcs" as a bare plural noun is the laity;
        # the adjective reading would need a noun to qualify.
        if token.endswith("s") and left1 in self.laity_bare_plural_left:
            return "laity"
        if right1 == "de" and right2 in self.state_right:
            return "state"

        lo, hi = max(0, idx - 8), min(len(tokens), idx + 9)
        window = tokens[lo:hi]
        laity_votes = sum(1 for t in window if t in self.laity_near)
        state_votes = sum(1 for t in window if t in self.state_near)
        return "laity" if laity_votes > state_votes else "state"


# =============================================================================
# Scan records
# =============================================================================

@dataclass
class Occurrence:
    """One matched form, located in one field of one item."""
    frame: str
    field: str
    start: int
    end: int
    quotable: bool          # False when the field is OCR and rights say no


@dataclass
class ItemScan:
    """Per-item intermediate produced by the single corpus scan.

    Extends the ``ArticleScan`` idea from ``generate_scary_terms.py`` with
    the item identity that block needs and this one cannot do without:
    scary-terms bundles are anonymous aggregates, while every panel here
    links back to an item page.
    """
    o_id: str
    subset: str
    title: str
    iwac_url: str
    year: Optional[int]
    countries: List[str]
    newspaper: str
    subjects: List[str]
    spatial: List[str]
    is_tagged: bool
    ocr_public: bool
    nb_mots: int
    #: Occurrences of a `membership_frames` frame — the "said" side of the
    #: tag-vs-text Venn. Hits in annotation-only frames do not count here.
    membership_hits: int = 0
    frame_counts: Dict[str, int] = field(default_factory=dict)
    occurrences: List[Occurrence] = field(default_factory=list)
    laity_demoted: int = 0
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def said(self) -> bool:
        """Does the item use the dossier's own vocabulary at all?"""
        return self.membership_hits > 0


# =============================================================================
# Generator
# =============================================================================

class LaiciteGenerator:
    """Build the laïcité dossier bundles from four IWAC subsets."""

    def __init__(
        self,
        output_dir: Path,
        repo_id: str = DATASET_ID,
        minify: bool = False,
        max_snippets: int = 3000,
        min_country_items: int = 3,
        seed: int = 20260804,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.repo_id = repo_id
        self.minify = minify
        self.max_snippets = max_snippets
        self.min_country_items = min_country_items
        self.rng = random.Random(seed)
        self.lex = Lexicon()
        self.logger = logging.getLogger(__name__)

        self.scans: List[ItemScan] = []
        self.texts: Dict[Tuple[str, str], Dict[str, str]] = {}
        self.subset_totals: Dict[str, int] = {}
        self.subset_public: Dict[str, int] = {}
        self.laity_by_subset: Dict[str, int] = defaultdict(int)
        self.state_by_subset: Dict[str, int] = defaultdict(int)

    # ---------------------------------------------------------------------
    #  Single corpus scan
    # ---------------------------------------------------------------------

    def scan_all(self) -> List[ItemScan]:
        if self.scans:
            return self.scans

        tag_folded = fold_plain(self.lex.authority.get("subject_label", "Laïcité"))
        for subset, fields in SUBSET_FIELDS.items():
            df = load_dataset_safe(
                subset, repo_id=self.repo_id, columns=SUBSET_COLUMNS[subset]
            )
            if df is None:
                raise RuntimeError(f"Failed to load '{subset}' subset")
            self.subset_totals[subset] = len(df)
            if "OCR_is_public" in df.columns:
                self.subset_public[subset] = int(df["OCR_is_public"].fillna(False).sum())
            else:
                self.subset_public[subset] = 0

            self.logger.info(f"Scanning '{subset}' ({len(df)} rows)…")
            members = 0
            for _, row in df.iterrows():
                rec = self._scan_row(row, subset, fields, tag_folded)
                if rec is not None:
                    self.scans.append(rec)
                    members += 1
            self.logger.info(
                f"  '{subset}': {members} dossier members "
                f"(laity-demoted occurrences: {self.laity_by_subset[subset]}, "
                f"state-kept ambiguous: {self.state_by_subset[subset]})"
            )

        self.logger.info(f"Scan complete: {len(self.scans)} dossier members total")
        return self.scans

    def _scan_row(
        self,
        row: pd.Series,
        subset: str,
        fields: List[Tuple[str, bool]],
        tag_folded: str,
    ) -> Optional[ItemScan]:
        subjects = parse_pipe_separated(row.get("subject"))
        is_tagged = any(fold_plain(s) == tag_folded for s in subjects)

        ocr_public = bool(row.get("OCR_is_public")) if "OCR_is_public" in row else False

        frame_counts: Dict[str, int] = defaultdict(int)
        occurrences: List[Occurrence] = []
        membership_hits = 0
        laity_demoted = 0
        texts: Dict[str, str] = {}

        for column, is_public_column in fields:
            if column not in row:
                continue
            value = row.get(column)
            if not isinstance(value, str) or not value.strip():
                continue
            texts[column] = value
            folded = fold_preserving(value)
            # One token list per field, plus a char→token index, so the
            # disambiguator can look at neighbours without re-tokenizing
            # per match.
            tokens, token_at = self._tokenize_with_offsets(folded)
            quotable = is_public_column or ocr_public

            claimed: List[Tuple[int, int]] = []
            for frame, pattern in self.lex.patterns.items():
                ambiguous_forms = self.lex.ambiguous.get(frame, set())
                for m in pattern.finditer(folded):
                    span = (m.start(), m.end())
                    # Longest-first alternation still lets two frames claim
                    # overlapping spans ("école laïque" is both `ecole` and
                    # `laicite`); keep the first claim per span.
                    if any(s < span[1] and span[0] < e for s, e in claimed):
                        continue
                    surface = m.group(0)
                    if surface in ambiguous_forms:
                        idx = token_at.get(m.start())
                        if idx is not None and \
                                self.lex.classify_ambiguous(tokens, idx) == "laity":
                            laity_demoted += 1
                            self.laity_by_subset[subset] += 1
                            continue
                        self.state_by_subset[subset] += 1
                    claimed.append(span)
                    frame_counts[frame] += 1
                    occurrences.append(Occurrence(
                        frame=frame, field=column,
                        start=span[0], end=span[1], quotable=quotable,
                    ))
                    if frame in self.lex.membership_frames:
                        membership_hits += 1

        if not is_tagged and membership_hits == 0:
            return None

        countries = normalize_country(row.get("country"), return_list=True)
        countries = [c for c in countries if c and c != "Unknown"]
        year = extract_year(row.get("pub_date"))

        rec = ItemScan(
            o_id=str(row.get("o:id") or ""),
            subset=subset,
            title=str(row.get("title") or "").strip(),
            iwac_url=str(row.get("iwac_url") or "").strip(),
            year=int(year) if year else None,
            countries=countries,
            newspaper=str(row.get("newspaper") or "").strip(),
            subjects=subjects,
            spatial=parse_pipe_separated(row.get("spatial")),
            is_tagged=is_tagged,
            ocr_public=ocr_public,
            nb_mots=int(row.get("nb_mots") or 0),
            membership_hits=membership_hits,
            frame_counts=dict(frame_counts),
            occurrences=occurrences,
            laity_demoted=laity_demoted,
        )
        if subset == "documents":
            rec.extra = {
                "author": str(row.get("author") or "").strip(),
                "type": str(row.get("type") or "").strip(),
                "nb_pages": int(row.get("nb_pages") or 0),
                "description": str(row.get("descriptionAI") or "").strip(),
                "pub_date": str(row.get("pub_date") or "").strip(),
            }
        elif subset == "references":
            rec.extra = {
                "author": str(row.get("author") or "").strip(),
                "resource_class": str(row.get("o:resource_class") or "").strip(),
            }
        self.texts[(subset, rec.o_id)] = texts
        return rec

    @staticmethod
    def _tokenize_with_offsets(folded: str) -> Tuple[List[str], Dict[int, int]]:
        """Token list plus a ``char offset → token index`` map."""
        tokens: List[str] = []
        token_at: Dict[int, int] = {}
        for i, m in enumerate(TOKEN_RE.finditer(folded)):
            tokens.append(m.group(0))
            token_at[m.start()] = i
        return tokens, token_at

    # ---------------------------------------------------------------------
    #  Bundles
    # ---------------------------------------------------------------------

    def build_metadata(self) -> Dict[str, Any]:
        """KPIs, the tag-vs-text Venn, and the rights split — per subset."""
        scans = self.scan_all()
        per_subset: Dict[str, Any] = {}

        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            tagged = sum(1 for s in sub if s.is_tagged)
            said = sum(1 for s in sub if s.said)
            both = sum(1 for s in sub if s.is_tagged and s.said)
            occ = sum(len(s.occurrences) for s in sub)
            quotable = sum(
                1 for s in sub for o in s.occurrences if o.quotable
            )
            years = [s.year for s in sub if s.year]
            per_subset[subset] = {
                "corpus_size": self.subset_totals.get(subset, 0),
                "members": len(sub),
                "tagged": tagged,
                "said": said,
                "tagged_and_said": both,
                "tagged_only": tagged - both,
                "said_only": said - both,
                "occurrences": occ,
                "quotable_occurrences": quotable,
                # The rights split, reported per subset — never as one
                # global percentage, which would imply an evenness that
                # does not exist (documents 25/26, references 7/867).
                "corpus_ocr_public": self.subset_public.get(subset, 0),
                "members_ocr_public": sum(1 for s in sub if s.ocr_public),
                "laity_demoted": sum(s.laity_demoted for s in sub),
                "year_range": [min(years), max(years)] if years else [],
            }

        countries = sorted({c for s in scans for c in s.countries})
        years = [s.year for s in scans if s.year]

        # Frame counts are reported PER SUBSET and never as one cross-subset
        # total. A single 300-page monograph in `references` contributes
        # hundreds of occurrences where a news item contributes three, so a
        # summed frame ranking would be a ranking of book lengths. The
        # per-item medians below are what makes the subsets comparable.
        frame_by_subset: Dict[str, Dict[str, Any]] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            totals: Dict[str, int] = defaultdict(int)
            items: Dict[str, int] = defaultdict(int)
            for s in sub:
                for frame, count in s.frame_counts.items():
                    totals[frame] += count
                    items[frame] += 1
            frame_by_subset[subset] = {
                "occurrences": dict(totals),
                "items": dict(items),
                # Share of this subset's members touching each frame — the
                # cross-subset-comparable figure.
                "item_share": {
                    f: round(n / len(sub), 4) for f, n in items.items()
                } if sub else {},
            }

        return {
            "generated_at": generate_timestamp(),
            "data_source": self.repo_id,
            "authority": self.lex.authority,
            "membership_rule": {
                "frames": self.lex.membership_frames,
                "note": self.lex.raw.get("_membership", ""),
            },
            "frames": self.lex.frame_labels(),
            "frame_order": list(self.lex.frames.keys()),
            "frame_by_subset": frame_by_subset,
            "frame_definitions": {
                name: list(spec["forms"]) for name, spec in self.lex.frames.items()
            },
            "subsets": per_subset,
            "totals": {
                "members": len(scans),
                "tagged": sum(1 for s in scans if s.is_tagged),
                "said": sum(1 for s in scans if s.said),
                "occurrences": sum(len(s.occurrences) for s in scans),
                "laity_demoted": sum(s.laity_demoted for s in scans),
                "countries": len(countries),
                "newspapers": len({s.newspaper for s in scans if s.newspaper}),
            },
            "countries": countries,
            "year_range": [min(years), max(years)] if years else [],
            # The full range runs to ~105 years because a handful of
            # `references` predate the press corpus by decades (earliest
            # 1922). Plotting that raw leaves four fifths of the axis empty,
            # so the client opens on the window where the evidence actually
            # sits and lets the reader zoom back out to the full range.
            "focus_range": self._focus_range(years),
            # Which text layer each subset was matched against, so the panel
            # can state what was actually searched rather than implying a
            # uniform full-text scan (references are mostly title+abstract:
            # only 423/867 carry OCR at all, and 7 are public).
            "matched_fields": {
                subset: [c for c, _ in fields]
                for subset, fields in SUBSET_FIELDS.items()
            },
            "rights_note": (
                "Counts are computed over all text; only readable snippets are "
                "gated on OCR_is_public, per source field."
            ),
        }

    @staticmethod
    def _focus_range(years: List[int], min_items: int = 3) -> List[int]:
        """The window holding the bulk of the evidence.

        Starts at the first year carrying ``min_items`` dossier items — the
        long thin tail of early scholarship is real data, not noise, but it
        should not set the default axis for a press-coverage timeline.
        """
        if not years:
            return []
        counts = Counter(years)
        dense = sorted(y for y, n in counts.items() if n >= min_items)
        if not dense:
            return [min(years), max(years)]
        return [dense[0], max(years)]

    def build_trends(self) -> Dict[str, Any]:
        """Aligned per-year series: global, per country, per frame, per subset.

        Shaped to match ``scary-terms-trends.json`` so ``scary-terms/trends.js``
        renders it unchanged (``years`` / ``families`` / ``global`` /
        ``by_country``), with two additions this block needs: ``by_subset``
        (press coverage and primary sources must never share a total without
        saying so) and item counts alongside occurrence counts.
        """
        scans = self.scan_all()
        frames = list(self.lex.frames.keys())
        years_present = sorted({s.year for s in scans if s.year})
        if not years_present:
            return {"years": [], "families": frames, "global": {}, "by_country": {}}
        years = list(range(years_present[0], years_present[-1] + 1))
        year_idx = {y: i for i, y in enumerate(years)}

        def blank() -> Dict[str, List[int]]:
            return {f: [0] * len(years) for f in frames}

        global_series = blank()
        by_country: Dict[str, Dict[str, List[int]]] = {}
        by_subset: Dict[str, Dict[str, List[int]]] = {}
        items_global = [0] * len(years)
        items_by_country: Dict[str, List[int]] = {}
        country_totals: Counter = Counter()

        for s in scans:
            if s.year is None or s.year not in year_idx:
                continue
            yi = year_idx[s.year]
            items_global[yi] += 1
            for frame, count in s.frame_counts.items():
                global_series[frame][yi] += count
            by_subset.setdefault(s.subset, blank())
            for frame, count in s.frame_counts.items():
                by_subset[s.subset][frame][yi] += count
            for country in s.countries:
                country_totals[country] += 1
                by_country.setdefault(country, blank())
                items_by_country.setdefault(country, [0] * len(years))
                items_by_country[country][yi] += 1
                for frame, count in s.frame_counts.items():
                    by_country[country][frame][yi] += count

        keep = {c for c, n in country_totals.items() if n >= self.min_country_items}
        by_country = {c: v for c, v in sorted(by_country.items()) if c in keep}
        items_by_country = {c: v for c, v in items_by_country.items() if c in keep}

        self.logger.info(
            f"Trends: {len(years)} years, {len(by_country)} countries, "
            f"{len(by_subset)} subsets")
        return {
            "years": years,
            "families": frames,
            "global": global_series,
            "by_country": by_country,
            "by_subset": by_subset,
            "items": {"global": items_global, "by_country": items_by_country},
        }

    def build_countries(self) -> Dict[str, Any]:
        """Per-country aggregates, split by subset and by frame."""
        scans = self.scan_all()
        out: Dict[str, Any] = {}
        for s in scans:
            for country in s.countries:
                bucket = out.setdefault(country, {
                    "items": 0,
                    "tagged": 0,
                    "occurrences": 0,
                    "by_subset": defaultdict(int),
                    "by_frame": defaultdict(int),
                    "newspapers": Counter(),
                    "years": Counter(),
                })
                bucket["items"] += 1
                bucket["tagged"] += 1 if s.is_tagged else 0
                bucket["occurrences"] += len(s.occurrences)
                bucket["by_subset"][s.subset] += 1
                for frame, count in s.frame_counts.items():
                    bucket["by_frame"][frame] += count
                if s.newspaper:
                    bucket["newspapers"][s.newspaper] += 1
                if s.year:
                    bucket["years"][str(s.year)] += 1

        result: Dict[str, Any] = {}
        for country, bucket in sorted(out.items()):
            if bucket["items"] < self.min_country_items:
                continue
            result[country] = {
                "items": bucket["items"],
                "tagged": bucket["tagged"],
                "occurrences": bucket["occurrences"],
                "by_subset": dict(bucket["by_subset"]),
                "by_frame": dict(sorted(
                    bucket["by_frame"].items(), key=lambda kv: -kv[1])),
                "top_newspapers": bucket["newspapers"].most_common(12),
                "by_year": dict(sorted(bucket["years"].items())),
            }
        return {
            "generated_at": generate_timestamp(),
            "min_country_items": self.min_country_items,
            "countries": result,
        }

    def build_documents(self) -> Dict[str, Any]:
        """The primary-source dossier — every matching `documents` item.

        Small by row count, large by research value: these are statutes,
        minutes, ministerial reports and petitions rather than coverage, and
        25 of 26 carry public text. They are emitted whole and never
        averaged into the press counts anywhere.
        """
        scans = [s for s in self.scan_all() if s.subset == "documents"]
        docs: List[Dict[str, Any]] = []
        for s in sorted(scans, key=lambda r: (r.year or 0, r.title)):
            texts = self.texts.get((s.subset, s.o_id), {})
            docs.append({
                "o_id": s.o_id,
                "title": s.title,
                "url": s.iwac_url,
                "year": s.year,
                "date": s.extra.get("pub_date", ""),
                "author": s.extra.get("author", ""),
                "type": s.extra.get("type", ""),
                "nb_pages": s.extra.get("nb_pages", 0),
                "nb_mots": s.nb_mots,
                "description": s.extra.get("description", ""),
                "countries": s.countries,
                "subjects": s.subjects,
                "spatial": s.spatial,
                "is_tagged": s.is_tagged,
                "ocr_public": s.ocr_public,
                "frame_counts": s.frame_counts,
                "occurrences": len(s.occurrences),
                "has_text": bool(texts.get("OCR")),
            })
        self.logger.info(f"Documents dossier: {len(docs)} primary sources")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Primary sources — statutes, minutes, ministerial reports, "
                "petitions. Never summed with press coverage."
            ),
            "documents": docs,
        }

    # -- concordance ------------------------------------------------------

    def build_concordance(self) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
        """KWIC rows with ±%d characters of context, rights-gated per field.

        Returns ``(index, per_subset_files)``. The rows fan out into one file
        per subset and are **normalized** — item identity (title, URL, year,
        country, newspaper) lives once in an ``items`` table and each row
        carries an index into it. A flat denormalized bundle measured 3.3 MB
        for 6,000 rows; this shape plus the fan-out puts the largest single
        file under a megabyte, and the reader only ever loads the corpus they
        are actually browsing.

        Sampling preserves the decade × country distribution rather than
        truncating by sort order, so capping does not silently turn the
        concordance into "the first N years of Côte d'Ivoire".
        """ % SNIPPET_CONTEXT
        scans = self.scan_all()
        per_subset_rows: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

        for s in scans:
            texts = self.texts.get((s.subset, s.o_id), {})
            cap = PER_ITEM_SNIPPET_CAP.get(s.subset)
            quotable = [o for o in s.occurrences if o.quotable and o.field in texts]
            if cap is not None and len(quotable) > cap:
                # Spread the per-item sample across frames so a long item
                # does not spend its whole budget on one repeated word.
                quotable = self._sample_across(quotable, cap, key=lambda o: o.frame)
            for occ in quotable:
                raw = texts[occ.field]
                per_subset_rows[s.subset].append({
                    "_scan": s,
                    "decade": (s.year // 10 * 10) if s.year else None,
                    "f": occ.frame,
                    "d": occ.field,
                    "l": self._clean_snippet(
                        raw[max(0, occ.start - SNIPPET_CONTEXT):occ.start], "left"),
                    "m": raw[occ.start:occ.end].strip(),
                    "r": self._clean_snippet(
                        raw[occ.end:occ.end + SNIPPET_CONTEXT], "right"),
                })

        files: Dict[str, Dict[str, Any]] = {}
        by_subset_counts: Dict[str, Dict[str, int]] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            occ_total = sum(len(s.occurrences) for s in sub)
            quotable_total = sum(1 for s in sub for o in s.occurrences if o.quotable)

            rows = per_subset_rows.get(subset, [])
            if len(rows) > self.max_snippets:
                rows = self._sample_across(
                    rows, self.max_snippets,
                    key=lambda r: (r["decade"],
                                   r["_scan"].countries[0] if r["_scan"].countries else ""),
                )
            rows.sort(key=lambda r: (r["_scan"].year or 0, r["_scan"].o_id))

            # Normalize: one entry per distinct item, rows point at it.
            items: List[Dict[str, Any]] = []
            index_of: Dict[str, int] = {}
            out_rows: List[Dict[str, Any]] = []
            for r in rows:
                s = r.pop("_scan")
                if s.o_id not in index_of:
                    index_of[s.o_id] = len(items)
                    entry = {
                        "o": s.o_id, "t": s.title, "u": s.iwac_url,
                        "y": s.year, "c": s.countries,
                    }
                    if s.newspaper:
                        entry["n"] = s.newspaper
                    if s.is_tagged:
                        entry["g"] = 1
                    items.append(entry)
                r.pop("decade", None)
                r["i"] = index_of[s.o_id]
                out_rows.append(r)

            files[subset] = {
                "generated_at": generate_timestamp(),
                "subset": subset,
                "context_chars": SNIPPET_CONTEXT,
                "items": items,
                "rows": out_rows,
            }
            by_subset_counts[subset] = {
                "occurrences": occ_total,
                "quotable": quotable_total,
                "withheld": occ_total - quotable_total,
                "emitted": len(out_rows),
                "items": len(items),
                "file": f"laicite-concordance-{subset}.json",
            }
            self.logger.info(
                f"  concordance/{subset}: {len(out_rows)} snippets over "
                f"{len(items)} items ({quotable_total} quotable of {occ_total} "
                f"occurrences; {occ_total - quotable_total} withheld by rights)")

        total_occ = sum(v["occurrences"] for v in by_subset_counts.values())
        total_quotable = sum(v["quotable"] for v in by_subset_counts.values())
        total_emitted = sum(v["emitted"] for v in by_subset_counts.values())
        self.logger.info(
            f"Concordance: {total_emitted} snippets emitted "
            f"({total_quotable} quotable of {total_occ} occurrences; "
            f"{total_occ - total_quotable} withheld by the rights gate)")

        index = {
            "generated_at": generate_timestamp(),
            "context_chars": SNIPPET_CONTEXT,
            "max_snippets_per_subset": self.max_snippets,
            "per_item_cap": dict(PER_ITEM_SNIPPET_CAP),
            "totals": {
                "occurrences": total_occ,
                "quotable": total_quotable,
                "withheld": total_occ - total_quotable,
                "emitted": total_emitted,
            },
            "by_subset": by_subset_counts,
            "row_keys": {
                "i": "index into items[]", "f": "frame", "d": "source field",
                "l": "left context", "m": "match", "r": "right context",
            },
        }
        return index, files

    def _sample_across(self, items: List[Any], cap: int, key) -> List[Any]:
        """Cap ``items`` at ``cap`` while keeping every ``key`` stratum
        represented in proportion — round-robin across strata, so small
        strata survive and large ones are thinned."""
        if len(items) <= cap:
            return items
        strata: Dict[Any, List[Any]] = defaultdict(list)
        for it in items:
            strata[key(it)].append(it)
        for bucket in strata.values():
            self.rng.shuffle(bucket)
        out: List[Any] = []
        order = sorted(strata.keys(), key=lambda k: str(k))
        while len(out) < cap:
            progressed = False
            for k in order:
                if strata[k]:
                    out.append(strata[k].pop())
                    progressed = True
                    if len(out) >= cap:
                        break
            if not progressed:
                break
        return out

    @staticmethod
    def _clean_snippet(text: str, side: str) -> str:
        """Collapse OCR whitespace so a KWIC line stays one line.

        Only the OUTER edge is trimmed. Stripping both would delete the
        space that separates the context from the highlighted match, and
        the rendered line would read "respect de lalaïcitépar le
        gouvernement" — the match is a separate element, so nothing else
        puts that boundary back.
        """
        collapsed = re.sub(r"\s+", " ", text)
        return collapsed.lstrip() if side == "left" else collapsed.rstrip()

    # ---------------------------------------------------------------------
    #  Output
    # ---------------------------------------------------------------------

    def write_all(self) -> None:
        self.scan_all()

        metadata = self.build_metadata()
        save_json(metadata, self.output_dir / "laicite-metadata.json",
                  minify=self.minify)

        documents = self.build_documents()
        save_json(documents, self.output_dir / "laicite-documents.json",
                  minify=self.minify)

        countries = self.build_countries()
        save_json(countries, self.output_dir / "laicite-countries.json",
                  minify=self.minify)

        # Data-heavy bundles are always minified regardless of --minify:
        # never human-diffed, not committed, lazy-loaded client-side —
        # the same rule the scary-terms trends/wordcloud/places bundles use.
        trends = self.build_trends()
        save_json(trends, self.output_dir / "laicite-trends.json", minify=True)

        index, files = self.build_concordance()
        save_json(index, self.output_dir / "laicite-concordance.json",
                  minify=self.minify)
        for subset, payload in files.items():
            save_json(payload,
                      self.output_dir / f"laicite-concordance-{subset}.json",
                      minify=True)

    def run(self) -> None:
        self.write_all()
        self.logger.info("Laïcité data generation complete")


# =============================================================================
# CLI
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Laïcité dossier JSON data for the "
                    "IwacVisualizations block."
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write the JSON files (default: asset/data).",
    )
    parser.add_argument(
        "--max-snippets",
        type=int,
        default=3000,
        help="Cap on concordance rows PER SUBSET (they fan out into one file "
             "each), sampled to preserve the decade × country distribution "
             "(default: %(default)s).",
    )
    parser.add_argument(
        "--min-country-items",
        type=int,
        default=3,
        help="Drop countries with fewer than this many dossier items "
             "(default: %(default)s).",
    )
    add_standard_args(parser, minify_default=False)
    args = parse_standard_args(parser)
    LaiciteGenerator(
        output_dir=Path(args.output_dir),
        repo_id=args.repo,
        minify=args.minify,
        max_snippets=args.max_snippets,
        min_country_items=args.min_country_items,
    ).run()


if __name__ == "__main__":
    main()
