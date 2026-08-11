#!/usr/bin/env python3
"""
generate_laicite.py
===================

Generate the JSON bundles consumed by the IwacVisualizations "Laïcité" page
block (GitHub issue #14) — a dossier on secularism in the IWAC corpus:

    asset/data/laicite-metadata.json      # KPIs, tag-vs-text Venn, rights split
    asset/data/laicite-trends.json        # per-year series, global/country/frame
    asset/data/laicite-countries.json     # per-country aggregates
    asset/data/laicite-documents.json     # the archival dossier
    asset/data/laicite-concordance.json   # KWIC rows — RIGHTS-GATED (see below)
    asset/data/laicite-collocates.json    # log-likelihood collocates, sliced
    asset/data/laicite-implicit.json      # vocabulary of the tagged-but-unsaid
    asset/data/laicite-corpora.json       # press vs periodicals, token-normalised
    asset/data/laicite-seasonality.json   # Gregorian vs lunar month profile
    asset/data/laicite-actors.json        # co-occurring persons / organisations
    asset/data/laicite-arenas.json        # frame x decade x country shares
    asset/data/laicite-sentiment.json     # three-model AI framing vs a baseline
    asset/data/laicite-places.json        # geocoded spatial mentions
    asset/data/laicite-references.json    # the scholarship, on its own axis
    asset/data/laicite-semantic.json      # UMAP map of the press half
    asset/data/laicite-circulation.json   # near-duplicate cross-outlet pairs
    asset/data/laicite-bylines.json       # who signs the beat, with denominators

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
   ``publications`` (Islamic periodicals), ``documents`` (archival material)
   and ``references`` (scholarship) are different evidentiary objects, so
   every record carries a ``subset`` discriminator and **no bundle sums
   across subsets without labelling it**. The first three are all primary
   sources — see ``SOURCE_TYPES``, which is about evidentiary status, not
   genre; ``references`` is the only one that is commentary rather than
   evidence, and it is excluded from every temporal facet for that reason.
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

from iwac_embeddings import coerce_embedding, pairs_above_threshold
from iwac_stats import keyness_for_slices
from iwac_utils import (
    DATASET_ID,
    SENTIMENT_FIELD_SUFFIXES,
    SENTIMENT_MODELS,
    STOPWORDS,
    add_standard_args,
    clean_float,
    extract_month_num,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    parse_standard_args,
    resolve_sentiment_columns,
    save_json,
    sentiment_columns,
    subjectivite_ordinal,
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
        "language", "OCR", "OCR_is_public", "nb_mots", "descriptionAI",
        "iwac_url", "hijri_month",
        # Bylines: who writes the beat, as against view 7's who it names.
        "author",
        # Register (view 9's second half): Flesch reading-ease and MATTR
        # lexical richness, both precomputed upstream. Two floats per row,
        # so no meaningful memory cost next to the columns above.
        "Lisibilite_OCR", "Richesse_Lexicale_OCR",
        # The three-model AI sentiment (view 9). load_dataset_safe keeps
        # whichever of these exist and logs the rest, so a snapshot that
        # predates a model swap still projects. `articles` is the only
        # subset carrying these columns.
        *[c for m in SENTIMENT_MODELS for f in SENTIMENT_FIELD_SUFFIXES
          for c in sentiment_columns(m, f)],
    ],
    "publications": [
        "o:id", "title", "newspaper", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "tableOfContents",
        "iwac_url", "hijri_month",
    ],
    "documents": [
        "o:id", "title", "author", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "descriptionAI", "iwac_url",
        "type", "nb_pages", "hijri_month",
    ],
    "references": [
        "o:id", "title", "author", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "abstract", "iwac_url",
        "o:resource_class",
    ],
}

# Evidentiary status, not genre. Press articles, Islamic periodicals and
# archival documents are all PRIMARY SOURCES — they differ in genre, not in
# what they are evidence of. `references` is the odd one out: it is not a
# source but scholarship *about* the others, it is largely anglophone, and
# it is dated by when the analysis was published rather than by the period
# analysed. Pooling its 9,167 occurrences with the sources' 11,530 makes the
# "all together" collocate list half a description of anglophone academic
# prose, which is why the split is offered as its own slicing.
SOURCE_TYPES: Dict[str, str] = {
    "articles": "primary",
    "publications": "primary",
    "documents": "primary",
    "references": "scholarship",
}

# Per-item snippet caps, by subset. Archival documents are uncapped (26 items,
# the densest and most quotable material in the collection); a periodical
# issue is a whole magazine so it earns more lines than a single article.
PER_ITEM_SNIPPET_CAP: Dict[str, Optional[int]] = {
    "documents": None,
    "publications": 12,
    "articles": 6,
    "references": 4,
}

# -----------------------------------------------------------------------
# Register accumulators (view 9's second half)
# -----------------------------------------------------------------------
#
# Two upstream columns, and the caveats attached to each are the reason
# this is a running sum rather than a list of values:
#
#   Lisibilite_OCR        Flesch reading-ease, French adaptation.
#   Richesse_Lexicale_OCR MATTR over a sliding 50-token window.
#
# MATTR is ALREADY length-robust — that is the entire reason upstream uses
# it instead of raw TTR — so nothing here may length-normalise it or bin
# it by `nb_mots` before comparing. It is also None below the 50-token
# window, which is a legitimate "unscored", not a zero.
#
# Both are lexicon-fitted to French, so they mis-score the collection's
# ~45 Ewé / Kabiyè / Dendi items. Those rows are unscored upstream and
# stay unscored here; a missing metric is never read as a low one. Since
# the generation-2 sentiment only annotates French and English articles
# anyway, and register is only computed within a subjectivity level, the
# non-French items drop out of this view twice over.
#
# Each metric counts its OWN n: an article scored for readability but not
# for richness contributes to the first mean and not the second.

def _register_bucket() -> Dict[str, float]:
    return {"n": 0, "read_sum": 0.0, "read_n": 0, "rich_sum": 0.0, "rich_n": 0}


def _register_add(
    bucket: Dict[str, float],
    readability: Optional[float],
    richness: Optional[float],
) -> None:
    bucket["n"] += 1
    if readability is not None:
        bucket["read_sum"] += readability
        bucket["read_n"] += 1
    if richness is not None:
        bucket["rich_sum"] += richness
        bucket["rich_n"] += 1


def _register_means(bucket: Dict[str, float]) -> Dict[str, Any]:
    """Bucket → the shape the panel reads, with n beside every mean.

    The n travels with the mean because these buckets get thin fast: a
    dossier of ~1,300 items split five ways leaves levels 1 and 5 with
    few dozen articles each, and a mean over 30 items rendered the same
    way as a mean over 400 invites a reading the data will not support.
    """
    return {
        "items": int(bucket["n"]),
        "readability": (round(bucket["read_sum"] / bucket["read_n"], 1)
                        if bucket["read_n"] else None),
        "readability_n": int(bucket["read_n"]),
        "richness": (round(bucket["rich_sum"] / bucket["rich_n"], 4)
                     if bucket["rich_n"] else None),
        "richness_n": int(bucket["rich_n"]),
    }


# -----------------------------------------------------------------------
# Semantic map (issue #19 C)
# -----------------------------------------------------------------------
# Smaller neighbourhood than the 12k-article Semantic Landscape block's
# default: at ~1,300 points, n_neighbors=15 starts smoothing away exactly
# the local structure a small map exists to show. Same reasoning, same
# values as the references-overview landscape.
SEMANTIC_N_NEIGHBORS = 10
SEMANTIC_MIN_DIST = 0.15
SEMANTIC_MIN_POINTS = 30
SEMANTIC_TITLE_LEN = 60

# -----------------------------------------------------------------------
# Circulation (issue #19 D)
# -----------------------------------------------------------------------
# 0.97 is generate_reprints.py's publication threshold, kept identical so
# "reprint" means the same thing in both blocks. That script re-derives
# the cut-off empirically on every data refresh (it logs a similarity
# histogram from 0.90 up); if it ever moves, move this with it.
CIRCULATION_THRESHOLD = 0.97
# Cap on the pair list the bundle ships as browsable rows. Every
# aggregate — the outlet network, the per-decade counts, the reprinted-item
# total — is computed over ALL detected pairs before this cut, so the cap
# shortens a list without ever shrinking a number.
CIRCULATION_MAX_LISTED = 300

# -----------------------------------------------------------------------
# Bylines (issue #19 F)
# -----------------------------------------------------------------------
# Enough to show the shape of a beat without turning the panel into a
# directory; the per-name floor (--min-byline-items) does the real
# filtering, and this only bounds the payload.
BYLINE_TOP_N = 40

SNIPPET_CONTEXT = 120   # characters either side of the match
TOKEN_RE = re.compile(r"[a-z]+")

# Half-width of the collocation window, in tokens. ±5 is the corpus-
# linguistics default and the span the issue specifies.
COLLOCATE_WINDOW = 5
# Minimum token length kept in the collocate/keyness vocabularies, matching
# iwac_utils.tokenize. Shorter tokens are function words in French.
MIN_TOKEN_LEN = 4


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

        # Every word appearing in any curated form, as folded tokens. These
        # are the selection criterion, so they are excluded from collocate
        # and keyness vocabularies — otherwise every slice would return the
        # selectors as their own top result.
        self.all_form_tokens: Set[str] = set()
        for spec in self.frames.values():
            for form in spec["forms"]:
                self.all_form_tokens.update(TOKEN_RE.findall(fold_plain(form)))
        self.all_form_tokens.update(TOKEN_RE.findall(fold_plain(" ".join(self.frames))))

        # Bilingual corpus: iwac_utils.STOPWORDS is French-only, and the
        # scholarly subset is largely English. Plus digitisation artefacts,
        # which are not vocabulary at all.
        self.extra_stopwords: Set[str] = {
            fold_plain(w) for w in raw.get("stopwords_en", [])
        } | {fold_plain(w) for w in raw.get("ocr_noise", [])}

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
        """Reader-facing labels and captions, per frame.

        The sidecar's bare ``note`` is deliberately NOT emitted: it is the
        internal rationale for whoever edits the lexicon (why a nearly-empty
        frame is kept, why a family is re-counted here rather than joined
        from the scary-terms bundles) and it is English-only. The caption
        the panel renders is ``note_en`` / ``note_fr``.
        """
        return {
            name: {
                "en": spec.get("label_en", name),
                "fr": spec.get("label_fr", name),
                "note_en": spec.get("note_en", ""),
                "note_fr": spec.get("note_fr", ""),
                # Optional sibling block this frame overlaps with, as a
                # registry slug. Data rather than a JS conditional so the
                # "which frame points where" judgement stays beside the
                # word list that motivates it; the panel renders a link
                # for any frame that declares one and nothing for the
                # rest.
                "cross_block": spec.get("cross_block", ""),
                "cross_en": spec.get("cross_en", ""),
                "cross_fr": spec.get("cross_fr", ""),
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
    #: Content tokens inside ±COLLOCATE_WINDOW of a membership-frame match…
    window_tokens: Counter = field(default_factory=Counter)
    #: …and every other content token in the item. The two partition the
    #: item's vocabulary, which is what makes them a valid keyness pair.
    rest_tokens: Counter = field(default_factory=Counter)
    #: Gregorian and lunar month of publication, for the seasonality view.
    month: Optional[int] = None
    hijri_month: Optional[int] = None
    #: Flesch reading-ease and MATTR lexical richness, for the register
    #: view. `articles` only, and None wherever upstream declined to score
    #: — which it legitimately does for texts under the 50-token MATTR
    #: window and for the non-French items (see build_register).
    readability: Optional[float] = None
    richness: Optional[float] = None
    #: Byline names, pipe-split. `articles` only. Includes press agencies
    #: alongside journalists — these are bylines, not people.
    authors: List[str] = field(default_factory=list)

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
        top_collocates: int = 40,
        min_collocate_count: int = 8,
        min_slice_count: int = 5,
        min_document_frequency: int = 3,
        min_implicit_documents: int = 4,
        min_implicit_terms: int = 8,
        min_newspaper_items: int = 5,
        min_actor_items: int = 4,
        min_place_items: int = 3,
        min_byline_items: int = 3,
        seed: int = 20260804,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.repo_id = repo_id
        self.minify = minify
        self.max_snippets = max_snippets
        self.min_country_items = min_country_items
        self.top_collocates = top_collocates
        self.min_collocate_count = min_collocate_count
        self.min_slice_count = min_slice_count
        self.min_document_frequency = min_document_frequency
        self.min_implicit_documents = min_implicit_documents
        self.min_implicit_terms = min_implicit_terms
        self.min_newspaper_items = min_newspaper_items
        self.min_actor_items = min_actor_items
        self.min_place_items = min_place_items
        self.min_byline_items = min_byline_items
        self._entities: Optional[Set[str]] = None
        #: Cached (X, scans) from _member_embeddings — two views need it.
        self._member_vectors: Optional[Tuple[Any, List["ItemScan"]]] = None
        self._index_df: Optional[pd.DataFrame] = None
        self._index_loaded = False
        #: Resolved per-model sentiment column names, filled while scanning
        #: `articles` (the only subset that carries them).
        self._sentiment_cols: Dict[str, Dict[str, Optional[str]]] = {}
        self.rng = random.Random(seed)
        self.lex = Lexicon()
        self.logger = logging.getLogger(__name__)

        self.scans: List[ItemScan] = []
        self.texts: Dict[Tuple[str, str], Dict[str, str]] = {}
        self.subset_totals: Dict[str, int] = {}
        self.subset_public: Dict[str, int] = {}
        self.laity_by_subset: Dict[str, int] = defaultdict(int)
        self.state_by_subset: Dict[str, int] = defaultdict(int)
        #: Sentiment over the WHOLE `articles` corpus, dossier or not. The
        #: comparison is what turns view 9 from a table into a finding, and
        #: it is free here — the rows are already in memory during the scan.
        self._baseline_sentiment: Dict[str, Dict[str, Any]] = {}

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
            if subset == "articles":
                self._sentiment_cols = resolve_sentiment_columns(df)

            self.logger.info(f"Scanning '{subset}' ({len(df)} rows)…")
            members = 0
            for _, row in df.iterrows():
                if subset == "articles":
                    self._tally_baseline_sentiment(row)
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
        # Token index of every membership-frame hit, per field, so the
        # collocate windows can be cut after the whole field is scanned.
        hit_token_idx: Dict[str, List[int]] = defaultdict(list)
        field_tokens: Dict[str, List[str]] = {}

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
            field_tokens[column] = tokens
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
                        idx = token_at.get(m.start())
                        if idx is not None:
                            hit_token_idx[column].append(idx)

        if not is_tagged and membership_hits == 0:
            return None

        window_tokens, rest_tokens = self._split_window_vocabulary(
            field_tokens, hit_token_idx)

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
            window_tokens=window_tokens,
            rest_tokens=rest_tokens,
            month=extract_month_num(row.get("pub_date")),
            hijri_month=(int(row["hijri_month"])
                         if "hijri_month" in row and pd.notna(row.get("hijri_month"))
                         else None),
            readability=clean_float(row.get("Lisibilite_OCR")),
            richness=clean_float(row.get("Richesse_Lexicale_OCR")),
            authors=(parse_pipe_separated(row.get("author"))
                     if subset == "articles" else []),
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
                "languages": parse_pipe_separated(row.get("language")),
                "abstract": str(row.get("abstract") or "").strip(),
            }
        elif subset == "articles":
            rec.extra = {"sentiment": self._row_sentiment(row)}
        self.texts[(subset, rec.o_id)] = texts
        return rec

    def _row_sentiment(self, row: pd.Series) -> Dict[str, Any]:
        """Pull the three-model AI sentiment off one `articles` row.

        Only the scored fields; the free-text justifications are never
        aggregated (the item page renders those straight from Omeka).
        Values are the raw French scale labels — the mapping to an ordinal
        belongs in the view, next to the axis it labels, not here.
        """
        out: Dict[str, Any] = {}
        for model, fields in self._sentiment_cols.items():
            entry: Dict[str, Any] = {}
            for key, column in fields.items():
                if not column or column not in row:
                    continue
                value = row.get(column)
                if value is None or (isinstance(value, float) and pd.isna(value)):
                    continue
                text = str(value).strip()
                if text:
                    entry[key] = text
            if entry:
                out[model] = entry
        return out

    def _tally_baseline_sentiment(self, row: pd.Series) -> None:
        """Fold one `articles` row into the corpus-wide sentiment baseline.

        Runs on every row, dossier member or not — that is the point: the
        baseline is what "laïcité coverage is more polemical than the press
        at large" is measured against.
        """
        readability = clean_float(row.get("Lisibilite_OCR"))
        richness = clean_float(row.get("Richesse_Lexicale_OCR"))
        for model, entry in self._row_sentiment(row).items():
            base = self._baseline_sentiment.setdefault(
                model, {"rated": 0, "polarity": Counter(),
                        "subjectivity": Counter(),
                        "register": defaultdict(_register_bucket)})
            base["rated"] += 1
            if entry.get("polarite"):
                base["polarity"][entry["polarite"]] += 1
            level = self._subjectivity_level(entry.get("subjectivite"))
            if level is not None:
                base["subjectivity"][level] += 1
                # The register comparison needs the corpus split by the
                # same subjectivity level as the dossier, not a single
                # corpus mean: the question is whether the polemical
                # register differs from the factual one *within* the
                # press at large too, or only inside this dossier.
                _register_add(base["register"][level], readability, richness)

    def _index_records(self) -> Optional[pd.DataFrame]:
        """The IWAC ``index`` authority file, loaded at most once.

        Three Phase 3 builders join against it (actors, places) and so does
        the collocate name-marking, which used to load it on its own. One
        load, one projection.
        """
        if self._index_loaded:
            return self._index_df
        self._index_loaded = True
        self._index_df = load_dataset_safe(
            "index",
            repo_id=self.repo_id,
            columns=["o:id", "Titre", "Titre alternatif", "Type", "Coordonnées"],
        )
        if self._index_df is None:
            self.logger.warning(
                "index subset unavailable — actors, places and entity-name "
                "marking will be empty")
        return self._index_df

    def _entity_tokens(self) -> Set[str]:
        """Tokens belonging to curated NAMED ENTITIES, from the index subset.

        The IWAC ``index`` is the collection's authority file: 2,843
        ``Personnes``, 686 ``Lieux``, 416 ``Organisations`` and 243
        ``Événements``, each a real catalogued entity. Reading names off it
        beats inferring them from capitalisation, which this generator tried
        first and abandoned — newspaper OCR is full of headings and all-caps
        tables of contents, so a mid-sentence-capitalisation test flagged
        10,514 tokens as names, most of them ordinary words.

        ``Sujets`` are deliberately NOT included: that is the research
        vocabulary (*Laïcité*, *Djihad*, *Charia*, *Excision*), and the
        repo's CLAUDE.md is explicit that it must never be filtered. Tokens
        appearing in a Sujets heading are subtracted even when some
        organisation's name also contains them, so the subject vocabulary
        wins every collision.
        """
        if self._entities is not None:
            return self._entities
        df = self._index_records()
        if df is None:
            self._entities = set()
            return self._entities

        named_types = {"Personnes", "Lieux", "Organisations", "Événements"}
        names: Set[str] = set()
        subjects: Set[str] = set()
        for _, row in df.iterrows():
            title = row.get("Titre")
            if not isinstance(title, str) or not title.strip():
                continue
            tokens = {
                t for t in TOKEN_RE.findall(fold_plain(title))
                if len(t) >= MIN_TOKEN_LEN
            }
            kind = str(row.get("Type") or "")
            if kind in named_types:
                names |= tokens
            elif kind == "Sujets":
                subjects |= tokens
        self._entities = names - subjects
        self.logger.info(
            f"  authority names: {len(self._entities)} tokens from the index "
            f"(Sujets research vocabulary preserved)")
        return self._entities

    def _split_window_vocabulary(
        self,
        field_tokens: Dict[str, List[str]],
        hit_token_idx: Dict[str, List[int]],
    ) -> Tuple[Counter, Counter]:
        """Partition an item's content tokens into in-window and out-of-window.

        The two counters are a *partition*, which is what makes them a valid
        pair for a keyness test: every content token lands in exactly one.
        The reference is therefore the rest of the same documents, not the
        whole collection — so a collocate means "sits near the word, more
        than elsewhere in writing already about the word", which is the
        question the view asks. A whole-corpus reference would instead
        rediscover every way laïcité documents differ from the archive at
        large, which the other views already show.

        The lexicon's own surface forms are excluded from both sides: they
        are the selection criterion, so leaving them in would just echo the
        selectors back as their own top collocates.
        """
        window: Counter = Counter()
        rest: Counter = Counter()
        for column, tokens in field_tokens.items():
            hits = hit_token_idx.get(column) or []
            in_window: Set[int] = set()
            for idx in hits:
                lo = max(0, idx - COLLOCATE_WINDOW)
                hi = min(len(tokens), idx + COLLOCATE_WINDOW + 1)
                in_window.update(range(lo, hi))
            for i, token in enumerate(tokens):
                if len(token) < MIN_TOKEN_LEN or token in STOPWORDS:
                    continue
                if token in self.lex.extra_stopwords:
                    continue
                if token in self.lex.all_form_tokens:
                    continue
                (window if i in in_window else rest)[token] += 1
        return window, rest

    @staticmethod
    def _tokenize_with_offsets(folded: str) -> Tuple[List[str], Dict[int, int]]:
        """Token list plus a ``char offset → token index`` map."""
        tokens: List[str] = []
        token_at: Dict[int, int] = {}
        for i, m in enumerate(TOKEN_RE.finditer(folded)):
            tokens.append(m.group(0))
            token_at[m.start()] = i
        return tokens, token_at

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

    # -- Phase 2: corpus linguistics --------------------------------------

    def build_collocates(self) -> Dict[str, Any]:
        """Log-likelihood collocates of the core forms (issue #14, view 5).

        Five slicings, all through ``iwac_stats.keyness_for_slices``:

        ``global``          in-window vocabulary vs the rest of the same documents
        ``by_source_type``  primary sources vs scholarship (see SOURCE_TYPES)
        ``by_decade``       each decade's window vocabulary vs the other decades'
        ``by_country``      each country's vs the others'
        ``by_subset``       each corpus's vs the others'

        ``by_source_type`` is the one to reach for first when a pooled list
        looks odd: scholarship supplies 44% of all occurrences and is written
        in a different language and register from the sources it analyses, so
        "all together" is a genuine mixture rather than a single population.

        The rest answer "and when/where did that change", which a
        single global list cannot. G² is the significance test only; ranking
        is by log-ratio effect size, with Benjamini–Hochberg correction
        inside each slice — ranking by G² is the classic keyness mistake
        that just returns the corpus's most frequent words.

        Scores are computed over **all** text, public or not: they are
        derived statistics, not verbatim reproduction, and restricting them
        to public rows would throw away most of the scholarship corpus for
        no rights benefit. Reading the actual lines stays gated — that is
        what the concordance is for, and the panel says so.
        """
        scans = self.scan_all()
        self.logger.info("Scoring collocates…")

        pooled_window: Counter = Counter()
        pooled_rest: Counter = Counter()
        by_decade: Dict[str, Counter] = defaultdict(Counter)
        by_country: Dict[str, Counter] = defaultdict(Counter)
        by_subset: Dict[str, Counter] = defaultdict(Counter)
        by_source: Dict[str, Counter] = defaultdict(Counter)
        decade_items: Counter = Counter()
        country_items: Counter = Counter()
        # Document frequency per slice: how many distinct items a token
        # appears in, as opposed to how many times. See _apply_df_floor.
        df: Dict[str, Counter] = defaultdict(Counter)

        for s in scans:
            if not s.window_tokens:
                continue
            distinct = set(s.window_tokens)
            pooled_window.update(s.window_tokens)
            pooled_rest.update(s.rest_tokens)
            by_subset[s.subset].update(s.window_tokens)
            source = SOURCE_TYPES.get(s.subset, "primary")
            by_source[source].update(s.window_tokens)
            df["window"].update(distinct)
            df["subset:" + s.subset].update(distinct)
            df["source:" + source].update(distinct)
            # `references` are deliberately absent from the temporal facet.
            # A reference's pub_date is when the ANALYSIS was published, not
            # when the discourse happened, so a 2022 monograph about the
            # 1990s would contribute its vocabulary to the 2020s slice and
            # misattribute it. (It also happens to be the mostly-anglophone
            # corpus, which was making the 2020s slice read as a list of
            # English function-adjacent words rather than a finding.)
            # Scholarship keeps its own slice under `by_subset`.
            if s.year and s.subset != "references":
                decade = f"{s.year // 10 * 10}s"
                by_decade[decade].update(s.window_tokens)
                decade_items[decade] += 1
                df["decade:" + decade].update(distinct)
            for country in s.countries:
                by_country[country].update(s.window_tokens)
                country_items[country] += 1
                df["country:" + country].update(distinct)

        def score(slices: Dict[str, Counter], min_count: int) -> Dict[str, Any]:
            # Two-slice comparisons need both sides populated; a slice with
            # nothing to compare against is dropped by keyness_for_slices.
            usable = {k: v for k, v in slices.items() if sum(v.values()) > 0}
            if len(usable) < 2:
                return {}
            return keyness_for_slices(
                usable, top_n=self.top_collocates, min_count=min_count)

        global_scored = score(
            {"window": pooled_window, "rest": pooled_rest}, self.min_collocate_count)
        global_list = self._apply_df_floor(
            global_scored.get("window", []), df["window"])

        # Thin slices cannot support the corpus-wide min_count, so drop
        # slices too small to test rather than reporting noise from them.
        def prune(slices: Dict[str, Counter], items: Counter, floor: int
                  ) -> Dict[str, Counter]:
            return {k: v for k, v in slices.items() if items.get(k, 0) >= floor}

        decades = prune(by_decade, decade_items, self.min_country_items)
        countries = prune(by_country, country_items, self.min_country_items)

        dropped_decades = sorted(set(by_decade) - set(decades))
        dropped_countries = sorted(set(by_country) - set(countries))
        if dropped_decades or dropped_countries:
            # Never cap coverage silently: a slice missing from the panel
            # must be explainable, not merely absent.
            self.logger.info(
                f"  collocates: dropped thin slices — decades {dropped_decades}, "
                f"countries {dropped_countries} (< {self.min_country_items} items)")

        # Both source-type slices are large (roughly 11.5k vs 9.2k
        # occurrences), so they carry the full corpus-wide min_count rather
        # than the relaxed thin-slice one.
        by_source_type = self._floor_slices(
            score(by_source, self.min_collocate_count), df, "source:")
        by_subset_scored = self._floor_slices(
            score(by_subset, self.min_slice_count), df, "subset:")
        dropped_subsets = sorted(set(by_subset) - set(by_subset_scored))
        if dropped_subsets:
            self.logger.info(
                f"  collocates: no token cleared the document-frequency floor "
                f"in subsets {dropped_subsets}")

        out = {
            "generated_at": generate_timestamp(),
            "window": COLLOCATE_WINDOW,
            "method": (
                "Dunning log-likelihood as the significance test, "
                "Benjamini-Hochberg corrected within each slice, ranked by "
                "log-ratio effect size."
            ),
            "reference": (
                "The rest of the same documents — a collocate sits near the "
                "word more than it does elsewhere in writing already about it."
            ),
            "source_scope": (
                "Press articles, Islamic periodicals and archival documents "
                "are all primary sources; scholarship is writing about them. "
                "It supplies 44% of all occurrences and is largely anglophone, "
                "so the pooled list mixes two populations — this slicing "
                "separates them."
            ),
            "decade_scope": (
                "Press, periodicals and archival documents only. Scholarship "
                "is excluded from the temporal slices: a reference is dated by "
                "when the analysis was published, not by the period it "
                "analyses, so it would misattribute its vocabulary to the "
                "decade it was written in."
            ),
            "min_count": self.min_collocate_count,
            "top_n": self.top_collocates,
            "min_document_frequency": self.min_document_frequency,
            "global": global_list,
            "by_source_type": by_source_type,
            "by_decade": self._floor_slices(
                score(decades, self.min_slice_count), df, "decade:"),
            "by_country": self._floor_slices(
                score(countries, self.min_slice_count), df, "country:"),
            "by_subset": by_subset_scored,
            "slice_sizes": {
                "decade": {k: decade_items[k] for k in decades},
                "country": {k: country_items[k] for k in countries},
                "subset": {k: sum(1 for s in scans if s.subset == k and s.window_tokens)
                           for k in by_subset},
                "source_type": {
                    k: sum(1 for s in scans
                           if SOURCE_TYPES.get(s.subset) == k and s.window_tokens)
                    for k in by_source
                },
            },
            "source_members": {
                k: sorted(sub for sub, t in SOURCE_TYPES.items() if t == k)
                for k in by_source
            },
            "dropped_slices": {
                "decades": dropped_decades, "countries": dropped_countries,
                "reason": f"fewer than {self.min_country_items} items",
                # A different reason, so a different key: these slices were
                # large enough to test and simply produced nothing that
                # appears in enough distinct documents to be vocabulary.
                "subsets": dropped_subsets,
                "subsets_reason": (
                    f"no token appeared in at least "
                    f"{self.min_document_frequency} distinct documents"
                ),
            },
        }
        self.logger.info(
            f"  collocates: {len(out['global'])} global, "
            f"{len(out['by_source_type'])} source types, "
            f"{len(out['by_decade'])} decades, {len(out['by_country'])} countries "
            f"(document-frequency floor {self.min_document_frequency})")
        return out

    def _apply_df_floor(
        self, scored: List[Dict[str, Any]], df: Counter
    ) -> List[Dict[str, Any]]:
        """Drop tokens confined to too few documents, and record the DF.

        A token repeated many times inside one or two items scores as
        strongly as one used steadily across fifty — but the first is
        usually an artefact (a scanner watermark stamped on every page, a
        proper name recurring through one long interview, a mis-OCRed word
        repeated down one bad scan) and the second is vocabulary. Requiring
        presence in several distinct documents separates them without
        touching domain terms, which recur across documents by nature.

        Applied AFTER scoring, so the Benjamini-Hochberg denominator still
        covers every token that was actually tested.
        """
        proper = self._entity_tokens()
        out = []
        for entry in scored:
            n_docs = int(df.get(entry["token"], 0))
            if n_docs < self.min_document_frequency:
                continue
            entry = dict(entry)
            entry["documents"] = n_docs
            # Catalogued entity names are kept and MARKED rather than
            # dropped: "who was speaking laïcité in this decade" is a
            # finding, not noise. They are excluded only from the implicit
            # lexicon, where the slice is small enough that they crowd out
            # everything else.
            if entry["token"] in proper:
                entry["proper"] = True
            out.append(entry)
        return out

    def _floor_slices(
        self, scored: Dict[str, List[Dict[str, Any]]], df: Dict[str, Counter],
        prefix: str,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """``_apply_df_floor`` across every slice of one facet."""
        out = {}
        for name, entries in scored.items():
            kept = self._apply_df_floor(entries, df.get(prefix + name, Counter()))
            if kept:
                out[name] = kept
        return out

    def build_implicit(self) -> Dict[str, Any]:
        """The vocabulary of the tagged-but-unsaid (review idea A).

        Items an archivist indexed under *Laïcité* that never use the word
        looked like a natural experiment: what vocabulary does the press use
        to argue laïcité *without* the term? Keyness of that slice against
        the items that do say it should answer directly.

        **Measured, it does not.** The idea was proposed expecting ~232 such
        articles, from the issue's arithmetic of 513 tagged minus 281 saying
        "laïcité". Counting the full core lexicon (``laïque``, ``laïc``,
        ``laïcisation``, …) rather than the single word leaves only **53**,
        and at that size the test has nothing to find: of the terms reaching
        significance, almost every one occurs in a single document. Requiring
        presence in even three of the 53 leaves a handful, and those are
        still names too local to be in the authority file, or one-off nouns
        from one article.

        So this builder reports a **negative result** rather than a ranked
        list: the 53 items appear to be tagged for heterogeneous reasons —
        each about its own matter — not because a consistent alternative
        vocabulary for laïcité exists in them. That is worth stating, and it
        is a far more defensible thing to publish than a list of surnames
        dressed as a discovery. The diagnostics that support the verdict ship
        alongside it so a reader can check the reasoning, and the moment the
        slice grows the same code yields a real list.
        """
        scans = self.scan_all()
        proper = self._entity_tokens()
        tagged_only: Counter = Counter()
        said: Counter = Counter()
        df_tagged: Counter = Counter()
        n_tagged_only = n_said = 0
        for s in scans:
            vocab = s.window_tokens + s.rest_tokens
            if s.is_tagged and not s.said:
                tagged_only.update(vocab)
                df_tagged.update(set(vocab))
                n_tagged_only += 1
            elif s.said:
                said.update(vocab)
                n_said += 1

        # Catalogued entity names are removed from BOTH sides here. With a slice this
        # small every name is perfectly slice-specific, so an unfiltered run
        # returns a list of people and organisations that appear in a handful
        # of Beninese articles — true, but it answers "who is named in these
        # 53 documents", not "how is laïcité argued without the word".
        for counter in (tagged_only, said):
            for token in list(counter):
                if token in proper:
                    del counter[token]

        scored: Dict[str, Any] = {}
        significant: List[Dict[str, Any]] = []
        if n_tagged_only and n_said:
            scored = keyness_for_slices(
                {"tagged_only": tagged_only, "said": said},
                top_n=max(self.top_collocates, 60),
                min_count=max(3, self.min_slice_count // 2),
            )
            significant = [
                dict(e, documents=int(df_tagged.get(e["token"], 0)))
                for e in scored.get("tagged_only", [])
            ]

        # A term confined to one or two of ~50 documents is that document's
        # subject matter, not the slice's signature.
        surviving = [
            e for e in significant
            if e["documents"] >= self.min_implicit_documents
        ]
        spread = Counter(
            min(e["documents"], 5) for e in significant
        )
        # The verdict the panel renders. "supported" only when enough terms
        # recur across documents to describe a shared vocabulary at all.
        has_vocabulary = len(surviving) >= self.min_implicit_terms
        self.logger.info(
            f"  implicit lexicon: {n_tagged_only} tagged-but-unsaid vs {n_said} "
            f"saying items → {len(significant)} significant, {len(surviving)} "
            f"in ≥{self.min_implicit_documents} documents → "
            f"{'shared vocabulary' if has_vocabulary else 'NO shared vocabulary'}")
        return {
            "generated_at": generate_timestamp(),
            "slice_sizes": {"tagged_only": n_tagged_only, "said": n_said},
            "tokens_tested": {
                "tagged_only": sum(tagged_only.values()),
                "said": sum(said.values()),
            },
            "note": (
                "Keyness of items tagged Laïcité that never use the word, "
                "against those that do. Catalogued entity names are removed "
                "from both sides, and a term must recur across distinct "
                "documents to count — otherwise the list is just the names "
                "and one-off nouns of a handful of items."
            ),
            "min_documents": self.min_implicit_documents,
            "min_terms_for_verdict": self.min_implicit_terms,
            "entity_names_excluded": True,
            # The verdict, and the evidence for it. `has_vocabulary` is what
            # the panel branches on: when false it states the negative result
            # instead of rendering `terms`, because a ranked list of
            # single-document words reads as a discovery when it is not one.
            "has_vocabulary": has_vocabulary,
            "diagnostics": {
                "significant_terms": len(significant),
                "surviving_terms": len(surviving),
                # How many documents each significant term occurs in, capped
                # at 5+. A distribution piled on 1 is the whole argument.
                "document_spread": {str(k): spread.get(k, 0) for k in range(1, 6)},
            },
            "terms": surviving,
            # Kept for audit even when the verdict is negative: a reader
            # should be able to see exactly what was rejected and why.
            "rejected_terms": [
                e for e in significant
                if e["documents"] < self.min_implicit_documents
            ][:40],
        }

    def build_corpora(self) -> Dict[str, Any]:
        """Press vs periodicals, normalised by tokens (issue #14, view 6).

        The headline contrast is that Muslim periodicals write about laïcité
        continuously while the mainstream press writes about it in crises.
        Item counts cannot show that: a 100-page periodical issue and a
        400-word news item are not commensurable, so every rate here is per
        10,000 words of the matched items, using ``nb_mots``.

        Also carries the per-newspaper frame fingerprints (review idea E) —
        the same contrast one level down, at outlet rather than corpus level.
        """
        scans = self.scan_all()
        frames = list(self.lex.frames.keys())

        per_subset: Dict[str, Any] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            if not sub:
                continue
            words = sum(s.nb_mots for s in sub)
            occ = sum(len(s.occurrences) for s in sub)
            frame_occ = {f: sum(s.frame_counts.get(f, 0) for s in sub) for f in frames}
            by_year: Dict[str, Dict[str, float]] = {}
            year_words: Counter = Counter()
            year_occ: Counter = Counter()
            for s in sub:
                if not s.year:
                    continue
                year_words[s.year] += s.nb_mots
                year_occ[s.year] += len(s.occurrences)
            for year in sorted(year_words):
                w = year_words[year]
                by_year[str(year)] = {
                    "items": sum(1 for s in sub if s.year == year),
                    "occurrences": year_occ[year],
                    "words": w,
                    "per_10k": round(year_occ[year] / w * 10000, 2) if w else None,
                }
            per_subset[subset] = {
                "items": len(sub),
                "words": words,
                "occurrences": occ,
                "per_10k": round(occ / words * 10000, 2) if words else None,
                "frame_per_10k": {
                    f: (round(n / words * 10000, 2) if words else None)
                    for f, n in frame_occ.items()
                },
                "frame_item_share": {
                    f: round(sum(1 for s in sub if s.frame_counts.get(f))
                             / len(sub), 4)
                    for f in frames
                },
                "by_year": by_year,
            }

        # Per-newspaper frame fingerprints, row-normalised so outlets of very
        # different sizes can be read on one scale.
        paper_items: Counter = Counter()
        paper_frames: Dict[str, Counter] = defaultdict(Counter)
        paper_subset: Dict[str, str] = {}
        paper_country: Dict[str, str] = {}
        for s in scans:
            if not s.newspaper:
                continue
            paper_items[s.newspaper] += 1
            paper_subset[s.newspaper] = s.subset
            if s.countries:
                paper_country[s.newspaper] = s.countries[0]
            for f in frames:
                if s.frame_counts.get(f):
                    paper_frames[s.newspaper][f] += 1

        newspapers = []
        for paper, n in paper_items.most_common():
            if n < self.min_newspaper_items:
                continue
            newspapers.append({
                "name": paper,
                "items": n,
                "subset": paper_subset.get(paper, ""),
                "country": paper_country.get(paper, ""),
                "frame_share": {
                    f: round(paper_frames[paper].get(f, 0) / n, 4) for f in frames
                },
            })
        self.logger.info(
            f"  corpora: {len(per_subset)} corpora, "
            f"{len(newspapers)} newspapers ≥ {self.min_newspaper_items} items")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Rates are per 10,000 words of the matched items, not per "
                "item: a periodical issue and a news article are not "
                "commensurable units."
            ),
            "frames": frames,
            "by_subset": per_subset,
            "min_newspaper_items": self.min_newspaper_items,
            "newspapers": newspapers,
        }

    def build_seasonality(self) -> Dict[str, Any]:
        """Gregorian vs lunar month profile (review idea B).

        Laïcité flashpoints are partly calendar-bound — hajj organisation,
        jours fériés, Ramadan school and workplace friction — but a lunar
        observance drifts ~11 days a year, so over sixty years it smears
        across all twelve Gregorian months and a Gregorian axis structurally
        cannot see it. The dataset ships ``hijri_month`` precomputed from the
        Umm al-Qura tables, so both profiles are emitted side by side.

        ``hijri_month`` is null wherever ``pub_date`` is not a complete
        YYYY-MM-DD, and ``references`` do not carry it at all, so the
        coverage denominator is reported per corpus rather than assumed.
        """
        scans = self.scan_all()
        out: Dict[str, Any] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            greg: Counter = Counter()
            hijri: Counter = Counter()
            for s in sub:
                if s.month:
                    greg[s.month] += 1
                if s.hijri_month:
                    hijri[s.hijri_month] += 1
            if not greg and not hijri:
                continue
            out[subset] = {
                "items": len(sub),
                "gregorian": [greg.get(m, 0) for m in range(1, 13)],
                "hijri": [hijri.get(m, 0) for m in range(1, 13)],
                "gregorian_coverage": sum(greg.values()),
                "hijri_coverage": sum(hijri.values()),
            }
        self.logger.info(f"  seasonality: {len(out)} corpora with dated items")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Lunar months are read from the dataset's precomputed "
                "hijri_month (Umm al-Qura), never re-derived in the browser: "
                "ICU disagrees with it on most pre-2000 dates."
            ),
            "by_subset": out,
        }

    # -- Phase 3: context --------------------------------------------------

    @staticmethod
    def _decade(year: Optional[int]) -> Optional[str]:
        return f"{year // 10 * 10}s" if year else None

    def _authority_index(self) -> Tuple[Dict[str, Dict[str, Any]], int]:
        """``normalized name → authority record`` over EVERY index type.

        Every type is indexed, not only the ones a caller wants, so that a
        subject string resolving to a ``Sujets`` record counts as resolved
        rather than landing in the unresolved list. Otherwise "unresolved"
        would be dominated by *Laïcité*, *Paix*, *Politique* — the research
        vocabulary, which is catalogued and simply is not an actor.
        """
        df = self._index_records()
        if df is None:
            return {}, 0
        by_name: Dict[str, Dict[str, Any]] = {}
        count = 0
        aliases: List[Tuple[str, Dict[str, Any]]] = []
        for _, row in df.iterrows():
            title = str(row.get("Titre") or "").strip()
            if not title:
                continue
            try:
                o_id = int(row["o:id"])
            except (TypeError, ValueError, KeyError):
                continue
            record = {
                "o_id": o_id,
                "name": title,
                "type": str(row.get("Type") or "").strip(),
                "coords": parse_coordinates(row.get("Coordonnées")),
            }
            count += 1
            by_name[normalize_location_name(title)] = record
            for alt in parse_pipe_separated(row.get("Titre alternatif")):
                key = normalize_location_name(alt)
                if key:
                    aliases.append((key, record))
        # Aliases are applied after every canonical title, so an alternative
        # title can never shadow another record's real one.
        for key, record in aliases:
            by_name.setdefault(key, record)
        return by_name, count

    def build_actors(self) -> Dict[str, Any]:
        """Who is speaking laïcité, and when (issue #14, view 7).

        Joins each dossier item's ``subject`` list against the IWAC index
        and keeps the records that are *actors*: persons, organisations and
        curated events. ``Sujets`` are excluded here — not because they are
        noise (the repo's CLAUDE.md is explicit that they are not) but
        because they answer a different question, and the frame legend and
        the arenas view already answer it.

        Counted once per item: an organisation named three times in one
        article is one item's worth of evidence, not three.
        """
        scans = self.scan_all()
        by_name, indexed = self._authority_index()
        actor_types = {"Personnes", "Organisations", "Événements"}

        stats: Dict[int, Dict[str, Any]] = {}
        unresolved: Counter = Counter()
        for s in scans:
            decade = self._decade(s.year)
            matched: Dict[int, Dict[str, Any]] = {}
            for raw in s.subjects:
                record = by_name.get(normalize_location_name(raw))
                if record is None:
                    unresolved[raw] += 1
                    continue
                if record["type"] in actor_types:
                    matched[record["o_id"]] = record
            for o_id, record in matched.items():
                st = stats.get(o_id)
                if st is None:
                    st = stats[o_id] = {
                        "o_id": o_id,
                        "name": record["name"],
                        "type": record["type"],
                        "items": 0,
                        "tagged": 0,
                        "by_decade": Counter(),
                        "by_country": Counter(),
                        "by_subset": Counter(),
                        "first_year": s.year,
                        "last_year": s.year,
                    }
                st["items"] += 1
                if s.is_tagged:
                    st["tagged"] += 1
                if decade:
                    st["by_decade"][decade] += 1
                for country in s.countries:
                    st["by_country"][country] += 1
                st["by_subset"][s.subset] += 1
                if s.year:
                    lo, hi = st["first_year"], st["last_year"]
                    st["first_year"] = s.year if lo is None else min(lo, s.year)
                    st["last_year"] = s.year if hi is None else max(hi, s.year)

        kept = [st for st in stats.values() if st["items"] >= self.min_actor_items]
        kept.sort(key=lambda st: (-st["items"], st["name"]))
        decades = sorted({d for st in kept for d in st["by_decade"]})

        actors = [{
            "o_id": st["o_id"],
            "name": st["name"],
            "type": st["type"],
            "items": st["items"],
            "tagged": st["tagged"],
            "first_year": st["first_year"],
            "last_year": st["last_year"],
            "by_decade": [st["by_decade"].get(d, 0) for d in decades],
            "by_country": dict(st["by_country"]),
            "by_subset": dict(st["by_subset"]),
        } for st in kept]

        self.logger.info(
            f"  actors: {len(actors)} of {len(stats)} authority records clear "
            f"{self.min_actor_items} items ({indexed} index records joined, "
            f"{len(unresolved)} subject strings unresolved)")
        return {
            "generated_at": generate_timestamp(),
            "min_items": self.min_actor_items,
            "types": sorted(actor_types),
            "decades": decades,
            "actors": actors,
            "index_records": indexed,
            "unresolved": [
                {"name": name, "count": n}
                for name, n in unresolved.most_common(20)
            ],
            "unresolved_total": len(unresolved),
            "note": (
                "Curated authority records co-occurring with the dossier's "
                "items, counted once per item. Subject headings are excluded: "
                "they are catalogued research vocabulary, not actors."
            ),
        }

    def build_arenas(self) -> Dict[str, Any]:
        """What is actually being contested under the word (view 8).

        Frame x decade x country, as the SHARE of that slice's dossier items
        touching each frame. Shares, not counts, because the slices differ by
        an order of magnitude in size and the question is about composition:
        "in Burkina Faso in the 2010s, what proportion of the laïcité dossier
        argues about schooling" is comparable across slices; the raw count is
        not.

        ``references`` are excluded for the same reason they are excluded
        from the collocate decade slices: a reference is dated by when the
        analysis was published, not by the period it analyses.
        """
        scans = self.scan_all()
        usable = [s for s in scans if s.year and s.subset != "references"]
        decades = sorted({self._decade(s.year) for s in usable if s.year})
        # Membership frames are excluded: an item is in the dossier BECAUSE
        # it says laïcité, so that panel reads ~95% in every decade — it is
        # the selection criterion, not an arena. Keeping it also forced the
        # shared y-axis to 100% and flattened the nine panels that are
        # actually contested into a row of stubs.
        excluded = list(self.lex.membership_frames)
        frames = [f for f in self.lex.frames if f not in excluded]

        def blank() -> Dict[str, List[int]]:
            return {f: [0] * len(decades) for f in frames}

        idx = {d: i for i, d in enumerate(decades)}
        global_counts = blank()
        global_totals = [0] * len(decades)
        by_country: Dict[str, Dict[str, List[int]]] = {}
        country_totals: Dict[str, List[int]] = {}
        country_items: Counter = Counter()

        for s in usable:
            i = idx[self._decade(s.year)]
            global_totals[i] += 1
            touched = [f for f in frames if s.frame_counts.get(f)]
            for frame in touched:
                global_counts[frame][i] += 1
            for country in s.countries:
                country_items[country] += 1
                if country not in by_country:
                    by_country[country] = blank()
                    country_totals[country] = [0] * len(decades)
                country_totals[country][i] += 1
                for frame in touched:
                    by_country[country][frame][i] += 1

        keep = {c for c, n in country_items.items() if n >= self.min_country_items}
        dropped = sorted(set(country_items) - keep)
        if dropped:
            self.logger.info(
                f"  arenas: dropped thin countries {dropped} "
                f"(< {self.min_country_items} items)")

        self.logger.info(
            f"  arenas: {len(frames)} frames x {len(decades)} decades x "
            f"{len(keep)} countries")
        return {
            "generated_at": generate_timestamp(),
            "frames": frames,
            "decades": decades,
            "countries": sorted(keep),
            "global": global_counts,
            "global_totals": global_totals,
            "by_country": {c: by_country[c] for c in sorted(keep)},
            "country_totals": {c: country_totals[c] for c in sorted(keep)},
            "dropped_countries": dropped,
            "membership_excluded": excluded,
            "scope": (
                "Press, periodicals and archival documents; scholarship is "
                "excluded from the decade axis because it is dated by when "
                "the analysis was published, not by the period it analyses. "
                "Membership frames are excluded as panels: they are the "
                "dossier's selection criterion, not something contested "
                "within it."
            ),
        }

    def build_sentiment(self) -> Dict[str, Any]:
        """AI framing of laïcité coverage (view 9).

        `articles` only — the sentiment annotation exists on no other
        subset. Three models are reported side by side rather than averaged:
        they disagree, and an average would hide both the disagreement and
        the fact that each figure is model output rather than catalogued
        metadata.

        Subjectivity ships as the full 1-5 distribution, never as a mean.
        The corpus mean is about 3 and the distribution is bimodal — laicite
        coverage splits into a factual register and a polemical one, and the
        mean lands in the trough between them where almost nothing sits.

        Every distribution is paired with the same distribution over the
        whole `articles` corpus, so the panel can answer "is this coverage
        unusual" rather than only "what does it look like".

        The `register` block extends that with the obvious follow-up: the
        subjectivity distribution says the dossier splits into two
        registers, and says nothing about whether they differ in anything
        else. Flesch readability and MATTR lexical richness, per
        subjectivity level, against the corpus at the same level, are the
        two columns that can answer it — see the accumulator notes above
        for what may and may not be done to them.
        """
        scans = self.scan_all()
        articles = [s for s in scans if s.subset == "articles"]
        models = [m for m in SENTIMENT_MODELS if self._sentiment_cols.get(m)]

        by_model: Dict[str, Any] = {}
        for model in models:
            polarity: Counter = Counter()
            centrality: Counter = Counter()
            subjectivity: Counter = Counter()
            pol_by_decade: Dict[str, Counter] = defaultdict(Counter)
            pol_by_paper: Dict[str, Counter] = defaultdict(Counter)
            paper_items: Counter = Counter()
            register: Dict[int, Dict[str, float]] = defaultdict(_register_bucket)
            rated = 0

            for s in articles:
                entry = (s.extra.get("sentiment") or {}).get(model) or {}
                if not entry:
                    continue
                rated += 1
                decade = self._decade(s.year)
                pol = entry.get("polarite")
                if pol:
                    polarity[pol] += 1
                    if decade:
                        pol_by_decade[decade][pol] += 1
                    if s.newspaper:
                        pol_by_paper[s.newspaper][pol] += 1
                        paper_items[s.newspaper] += 1
                if entry.get("centralite"):
                    centrality[entry["centralite"]] += 1
                level = self._subjectivity_level(entry.get("subjectivite"))
                if level is not None:
                    subjectivity[level] += 1
                    _register_add(register[level], s.readability, s.richness)

            papers = [
                {
                    "newspaper": name,
                    "items": paper_items[name],
                    "polarity": dict(pol_by_paper[name]),
                }
                for name, n in paper_items.most_common()
                if n >= self.min_newspaper_items
            ]
            base = self._baseline_sentiment.get(model, {})
            by_model[model] = {
                "rated": rated,
                "polarity": dict(polarity),
                "centrality": dict(centrality),
                "subjectivity": [subjectivity.get(i, 0) for i in range(1, 6)],
                "polarity_by_decade": {
                    d: dict(c) for d, c in sorted(pol_by_decade.items())
                },
                "by_newspaper": papers,
                # Register: is the polemical half of the bimodal
                # subjectivity distribution also lexically distinct? Five
                # levels, each carrying both metrics for the dossier and
                # for the whole corpus at that same level.
                "register": [
                    {
                        "level": level,
                        "dossier": _register_means(register[level]),
                        "corpus": _register_means(
                            base.get("register", {}).get(level) or _register_bucket()
                        ),
                    }
                    for level in range(1, 6)
                ],
                "corpus": {
                    "rated": base.get("rated", 0),
                    "polarity": dict(base.get("polarity", {})),
                    "subjectivity": [
                        base.get("subjectivity", {}).get(i, 0) for i in range(1, 6)
                    ],
                },
            }

        self.logger.info(
            "  sentiment: " + ", ".join(
                f"{m} {by_model[m]['rated']}/{len(articles)}" for m in models)
            or "  sentiment: no model columns present")
        return {
            "generated_at": generate_timestamp(),
            "models": models,
            "items": len(articles),
            "corpus_items": self.subset_totals.get("articles", 0),
            "min_newspaper_items": self.min_newspaper_items,
            "by_model": by_model,
            # Derived from SENTIMENT_MODELS rather than spelled out: this
            # sentence named the January-February 2026 generation-1 models
            # for one release after the generator had already been
            # repointed at the generation-2 columns, i.e. it told readers
            # the wrong three models had produced the numbers on screen.
            # A hand-maintained list beside a constant is a list that goes
            # stale.
            "ai_note": (
                "These values are model output, not catalogued metadata. "
                "Three models annotated the corpus independently: "
                + ", ".join(m.replace("_", "-") for m in models[:-1])
                + (" and " if len(models) > 1 else "")
                + (models[-1].replace("_", "-") if models else "")
                + ". They are reported separately because they disagree."
            ),
        }

    @staticmethod
    def _subjectivity_level(value: Any) -> Optional[int]:
        """The 1-5 subjectivity scale, from either a label or a number.

        Thin wrapper so the two call sites keep reading as domain code;
        the label table itself is shared with every other generator.
        """
        return subjectivite_ordinal(value)

    # ---------------------------------------------------------------------
    #  Semantic map (issue #19 C)
    # ---------------------------------------------------------------------

    @staticmethod
    def _empty_semantic(reason: str, embedded: int = 0, total: int = 0
                        ) -> Dict[str, Any]:
        """Empty-state contract, same shape as a populated bundle.

        The panel is optional and UMAP is this script's only optional
        dependency; a dossier refresh must not fail because it is
        missing. Same convention as
        ``generate_references_overview._empty_landscape``.
        """
        return {
            "generated_at": generate_timestamp(),
            "frames": [],
            "countries": [],
            "decades": [],
            "points": {
                "o_id": [], "x": [], "y": [], "title": [],
                "frame": [], "country": [], "decade": [], "year": [],
            },
            "meta": {
                "embedded": int(embedded),
                "total": int(total),
                "reason": reason,
                "subsets": ["articles"],
                "umap": None,
            },
        }

    def _member_embeddings(self) -> Tuple[Any, List[ItemScan]]:
        """``(X, scans)`` — unit-normalised vectors for dossier articles.

        Loaded once and cached: two views need it (the semantic map and
        circulation) and the column is 768 floats a row.

        Read HERE rather than in the main scan because ``SUBSET_COLUMNS``
        is deliberately narrow — the pandas conversion of an embedding
        column, not the download, is where the memory goes. A second
        two-column read filtered straight down to dossier members costs
        less than carrying the column through the whole scan.

        ``X[k]`` is the vector of ``scans[k]``, so callers index the two
        together and never need the DataFrame again.
        """
        if self._member_vectors is not None:
            return self._member_vectors

        import numpy as np

        empty = (np.zeros((0, 0), dtype=np.float32), [])
        members = {s.o_id: s for s in self.scan_all() if s.subset == "articles"}
        if not members:
            self._member_vectors = empty
            return empty

        df = load_dataset_safe(
            "articles", repo_id=self.repo_id,
            columns=["o:id", "embedding_OCR"],
        )
        if df is None or "embedding_OCR" not in df.columns:
            self.logger.warning(
                "articles carries no embedding_OCR — the semantic map and "
                "circulation views will render their empty states")
            self._member_vectors = empty
            return empty

        vectors: List[Any] = []
        scans: List[ItemScan] = []
        dim: Optional[int] = None
        for _, row in df.iterrows():
            scan = members.get(str(row.get("o:id") or "").strip())
            if scan is None:
                continue
            vec = coerce_embedding(row.get("embedding_OCR"))
            if vec is None:
                continue
            if dim is None:
                dim = len(vec)
            elif len(vec) != dim:
                continue
            vectors.append(vec)
            scans.append(scan)

        if not vectors:
            self._member_vectors = empty
            return empty

        X = np.vstack(vectors)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        X = X / np.where(norms == 0.0, 1.0, norms)
        self.logger.info(
            "  embeddings: %d of %d dossier articles carry a usable vector",
            len(scans), len(members))
        self._member_vectors = (X, scans)
        return self._member_vectors

    def build_semantic(self) -> Dict[str, Any]:
        """2-D UMAP projection of the dossier's press half.

        Two jobs. It is a discovery view — discourse clusters that cut
        across the hand-crafted frames — and a robustness check on the
        frame taxonomy itself: if the embedding clusters do not roughly
        recover the curated frames, that is worth knowing before anyone
        publishes the arena counts from the arenas view.

        **`articles` only, and the panel says so.** This is a constraint
        of the data, not a shortcut:

        * ``articles`` carry ``embedding_OCR`` — a vector of the text.
        * ``publications`` carry ``embedding_tableOfContents`` and no
          ``embedding_OCR``. It is the same 768-dim gemini space, so the
          arithmetic would work, which is exactly the trap: a magazine's
          contents page and an article's body are different objects, and
          co-projecting them would place a periodical by its index rather
          than by what it argues. This block's own rule is that no bundle
          sums across subsets without labelling it; silently mixing two
          kinds of vector would break that rule invisibly.
        * ``documents`` carry no embedding at all.
        * ``references`` do carry ``embedding_OCR``, but they are
          scholarship *about* the sources rather than sources, which is
          why every temporal facet in this block already excludes them.
          They keep their own axis in the bibliography view.

        So the map covers the press, ``meta.subsets`` names it, and
        ``meta.embedded`` / ``meta.total`` carry the denominators.
        """
        total = sum(1 for s in self.scan_all() if s.subset == "articles")
        if total < SEMANTIC_MIN_POINTS:
            return self._empty_semantic("too_few_items", 0, total)

        try:
            import umap  # type: ignore
        except ImportError:
            self.logger.warning(
                "umap-learn is not installed — the semantic map panel will "
                "render its empty state (pip install umap-learn)")
            return self._empty_semantic("umap_not_installed", 0, total)

        X, scans = self._member_embeddings()
        embedded = len(scans)
        if embedded < SEMANTIC_MIN_POINTS:
            return self._empty_semantic(
                "missing_embedding_column" if embedded == 0 else "too_few_embeddings",
                embedded, total)

        records: List[Dict[str, Any]] = []
        keep: List[int] = []
        for k, scan in enumerate(scans):
            # Every point is a click-through to /item/<id>, so a row
            # without a usable Omeka id has nowhere to link.
            try:
                point_id = int(scan.o_id)
            except (TypeError, ValueError):
                continue
            title = scan.title
            if len(title) > SEMANTIC_TITLE_LEN:
                title = title[: SEMANTIC_TITLE_LEN - 1].rstrip() + "…"
            keep.append(k)
            records.append({
                "o_id": point_id,
                "title": title,
                "frame": self._dominant_annotation_frame(scan),
                "country": scan.countries[0] if scan.countries else "",
                "year": scan.year,
                "decade": self._decade(scan.year) or "",
            })

        embedded = len(records)
        if embedded < SEMANTIC_MIN_POINTS:
            return self._empty_semantic("too_few_embeddings", embedded, total)
        X = X[keep]

        neighbors = max(2, min(SEMANTIC_N_NEIGHBORS, embedded - 1))
        self.logger.info(
            "  semantic map: UMAP over %d of %d dossier articles "
            "(n_neighbors=%d, metric=cosine)",
            embedded, total, neighbors)
        reducer = umap.UMAP(
            n_components=2,
            n_neighbors=neighbors,
            min_dist=SEMANTIC_MIN_DIST,
            metric="cosine",
            random_state=42,
        )
        coords = reducer.fit_transform(X)

        def _table(key: str, sort_key: Any) -> Tuple[List[str], Dict[str, int]]:
            names = sorted({r[key] for r in records if r[key]}, key=sort_key)
            return names, {name: i for i, name in enumerate(names)}

        frame_names, frame_index = _table("frame", lambda v: v.lower())
        country_names, country_index = _table("country", lambda v: v.lower())
        decade_names, decade_index = _table("decade", lambda v: v)

        points: Dict[str, List[Any]] = {
            "o_id": [], "x": [], "y": [], "title": [],
            "frame": [], "country": [], "decade": [], "year": [],
        }
        for i, record in enumerate(records):
            points["o_id"].append(record["o_id"])
            points["x"].append(round(float(coords[i, 0]), 2))
            points["y"].append(round(float(coords[i, 1]), 2))
            points["title"].append(record["title"])
            points["frame"].append(frame_index.get(record["frame"], -1))
            points["country"].append(country_index.get(record["country"], -1))
            points["decade"].append(decade_index.get(record["decade"], -1))
            points["year"].append(record["year"])

        return {
            "generated_at": generate_timestamp(),
            "frames": frame_names,
            "countries": country_names,
            "decades": decade_names,
            "points": points,
            "meta": {
                "embedded": embedded,
                "total": total,
                "reason": "",
                "subsets": ["articles"],
                "umap": {
                    "n_neighbors": neighbors,
                    "min_dist": SEMANTIC_MIN_DIST,
                    "metric": "cosine",
                    "random_state": 42,
                },
            },
        }

    # ---------------------------------------------------------------------
    #  Bylines (issue #19 F)
    # ---------------------------------------------------------------------

    def build_bylines(self) -> Dict[str, Any]:
        """Who writes the laïcité beat, per outlet and per decade.

        The complement to the actors view, which answers who the coverage
        *names*. Together they are the actor picture the dossier needs:
        one is the subject of the writing, this is its source.

        **The denominator is the whole panel.** Byline coverage in the
        corpus is uneven — it varies by outlet and, sharply, by decade,
        because older material is more often unsigned and because OCR of
        a signature line is less reliable than OCR of body text. A ranked
        list of names on its own would read as "these journalists owned
        the beat" when part of the answer is "we do not know who wrote
        the rest". So every figure ships beside the count it is drawn
        from: ``signed`` against ``articles`` globally, and the same pair
        per decade and per outlet, so a reader can see where the record
        is thin before reading anything into a ranking over it.

        ``articles`` only: an issue of a periodical has no single byline,
        an archival document's author is a different kind of claim, and a
        reference's author is its scholar rather than a journalist.

        Bylines are NOT people. Press agencies (Agence Togolaise de
        Presse, PANA) sign alongside journalists and are left in, labelled
        as bylines, because an agency signature is exactly the circulation
        signal the neighbouring view measures another way.
        """
        articles = [s for s in self.scan_all() if s.subset == "articles"]
        total = len(articles)

        counts: Counter = Counter()
        first_year: Dict[str, int] = {}
        last_year: Dict[str, int] = {}
        by_paper: Dict[str, Counter] = defaultdict(Counter)
        by_decade_name: Dict[str, Counter] = defaultdict(Counter)
        # Coverage denominators, which are the point of the view.
        decade_signed: Counter = Counter()
        decade_total: Counter = Counter()
        paper_signed: Counter = Counter()
        paper_total: Counter = Counter()
        signed = 0

        for s in articles:
            decade = self._decade(s.year)
            if decade:
                decade_total[decade] += 1
            if s.newspaper:
                paper_total[s.newspaper] += 1
            if not s.authors:
                continue
            signed += 1
            if decade:
                decade_signed[decade] += 1
            if s.newspaper:
                paper_signed[s.newspaper] += 1
            for name in s.authors:
                counts[name] += 1
                if s.year is not None:
                    if name not in first_year or s.year < first_year[name]:
                        first_year[name] = s.year
                    if name not in last_year or s.year > last_year[name]:
                        last_year[name] = s.year
                if s.newspaper:
                    by_paper[name][s.newspaper] += 1
                if decade:
                    by_decade_name[name][decade] += 1

        top = [
            {
                "name": name,
                "count": int(count),
                "first": first_year.get(name),
                "last": last_year.get(name),
                "newspapers": [
                    {"name": paper, "count": int(n)}
                    for paper, n in by_paper[name].most_common(3)
                ],
                "by_decade": dict(sorted(by_decade_name[name].items())),
            }
            for name, count in counts.most_common(BYLINE_TOP_N)
            if count >= self.min_byline_items
        ]

        self.logger.info(
            "  bylines: %d of %d dossier articles signed (%d distinct names, "
            "%d at or above the %d-item floor)",
            signed, total, len(counts), len(top), self.min_byline_items)

        return {
            "generated_at": generate_timestamp(),
            "articles": total,
            "signed": signed,
            "unique": len(counts),
            "min_items": self.min_byline_items,
            "by_decade": [
                {
                    "decade": decade,
                    "articles": int(decade_total[decade]),
                    "signed": int(decade_signed[decade]),
                }
                for decade in sorted(decade_total)
            ],
            "by_newspaper": [
                {
                    "name": paper,
                    "articles": int(paper_total[paper]),
                    "signed": int(paper_signed[paper]),
                }
                for paper, _ in paper_total.most_common()
                if paper_total[paper] >= self.min_newspaper_items
            ],
            "top": top,
        }

    # ---------------------------------------------------------------------
    #  Circulation (issue #19 D)
    # ---------------------------------------------------------------------

    def build_circulation(self) -> Dict[str, Any]:
        """Near-duplicate laïcité articles across different outlets.

        The question none of the other views can answer: does this
        coverage **circulate**? A communiqué reprinted verbatim by eleven
        papers, a PANA dispatch picked up across a border, and eleven
        newsrooms independently covering the same controversy are
        indistinguishable on a per-year item count — and they are not the
        same finding. It matters directly for the argument the dossier
        backs: a claim about the volume of debate is weaker if the volume
        is one press release printed eleven times.

        Method is ``generate_reprints.py``'s, scoped to the dossier:
        cosine similarity over L2-normalised ``embedding_OCR``, publish
        pairs above a high threshold whose two articles carry different
        newspaper names. Scoped rather than joined because that block's
        published bundle is capped at its top-N pairs by similarity and
        would silently under-report a small slice; and because ~1,300
        members is a cheap all-pairs scan where the full corpus is not.

        **A within-dossier scan can only see reprints where BOTH copies
        are members.** In practice a verbatim reprint of a laïcité
        article matches the same lexicon and joins the dossier too, so
        the pairs are near-complete — but a copy whose OCR is too poor to
        match would be missed, and the panel says the count is a floor
        rather than a census.
        """
        X, scans = self._member_embeddings()
        if len(scans) < 2:
            return {
                "generated_at": generate_timestamp(),
                "threshold": CIRCULATION_THRESHOLD,
                "scanned": len(scans),
                "listed": 0,
                "total_pairs": 0,
                "pairs": [],
                "links": [],
                "newspapers": [],
                "reprinted_items": 0,
                "median_year_gap": None,
                "by_decade": {},
            }

        pairs: List[Dict[str, Any]] = []
        for i, j, sim in pairs_above_threshold(X, CIRCULATION_THRESHOLD):
            a, b = scans[i], scans[j]
            # Same outlet is not circulation — it is a correction, a
            # second edition, or the same piece indexed twice.
            if not a.newspaper or not b.newspaper or a.newspaper == b.newspaper:
                continue
            pairs.append({
                "similarity": round(sim, 4),
                "a": self._circulation_side(a),
                "b": self._circulation_side(b),
                "year_gap": self._year_gap(a, b),
            })

        pairs.sort(key=lambda p: -p["similarity"])

        # Aggregates run over EVERY detected pair, before the display cap
        # below: a "12% of the dossier is reprinted copy" figure computed
        # from a truncated list would be wrong in the one direction a
        # reader cannot detect.
        link_counts: Dict[frozenset, int] = defaultdict(int)
        paper_counts: Counter = Counter()
        reprinted: Set[str] = set()
        by_decade: Counter = Counter()
        for p in pairs:
            pa, pb = p["a"]["newspaper"], p["b"]["newspaper"]
            link_counts[frozenset((pa, pb))] += 1
            paper_counts[pa] += 1
            paper_counts[pb] += 1
            reprinted.add(p["a"]["o_id"])
            reprinted.add(p["b"]["o_id"])
            for side in ("a", "b"):
                decade = self._decade(p[side]["year"])
                if decade:
                    by_decade[decade] += 1

        links = []
        for pair, count in sorted(link_counts.items(),
                                  key=lambda kv: (-kv[1], sorted(kv[0]))):
            left, right = sorted(pair)
            links.append([left, right, count])

        gaps = sorted(p["year_gap"] for p in pairs if p["year_gap"] is not None)
        median_gap = gaps[len(gaps) // 2] if gaps else None

        self.logger.info(
            "  circulation: %d cross-outlet pairs ≥ %.2f over %d embedded "
            "articles, touching %d items",
            len(pairs), CIRCULATION_THRESHOLD, len(scans), len(reprinted))

        return {
            "generated_at": generate_timestamp(),
            "threshold": CIRCULATION_THRESHOLD,
            # The denominator every share on the panel is taken against.
            "scanned": len(scans),
            "listed": min(len(pairs), CIRCULATION_MAX_LISTED),
            "total_pairs": len(pairs),
            "reprinted_items": len(reprinted),
            "median_year_gap": median_gap,
            "by_decade": dict(sorted(by_decade.items())),
            "newspapers": [
                {"name": name, "pairs": int(count)}
                for name, count in sorted(paper_counts.items(),
                                          key=lambda kv: (-kv[1], kv[0]))
            ],
            "links": links,
            "pairs": pairs[:CIRCULATION_MAX_LISTED],
        }

    @staticmethod
    def _circulation_side(scan: ItemScan) -> Dict[str, Any]:
        return {
            "o_id": scan.o_id,
            "title": scan.title,
            "newspaper": scan.newspaper,
            "country": scan.countries[0] if scan.countries else "",
            "year": scan.year,
        }

    @staticmethod
    def _year_gap(a: ItemScan, b: ItemScan) -> Optional[int]:
        """Years between two items, or None when either is undated.

        Years rather than days: the scan works off ``ItemScan``, which
        keeps the parsed year and not the raw date, and a great many of
        these items are ``YYYY``-only anyway. A day-level gap would be
        precision the dossier's dates do not support.
        """
        if a.year is None or b.year is None:
            return None
        return abs(a.year - b.year)

    def _dominant_annotation_frame(self, scan: ItemScan) -> str:
        """The frame that best characterises this item, or "".

        Membership frames are excluded: an item is in the dossier
        *because* it says laïcité, so colouring by `laicite` would paint
        almost every point one colour and encode the selection criterion
        instead of anything about the item. The arenas view excludes them
        from its small multiples for the same reason.
        """
        membership = set(self.lex.membership_frames)
        counts = {f: n for f, n in scan.frame_counts.items()
                  if f not in membership and n > 0}
        if not counts:
            return ""
        return max(sorted(counts), key=lambda f: counts[f])

    def build_places(self) -> Dict[str, Any]:
        """Geocoded places tagged on dossier items (view 10).

        Joins ``spatial`` (a pipe list of ``index.Titre`` values) against the
        index's ``Lieux`` records that carry parseable ``Coordonnées``.
        Counted once per item, like the actors.
        """
        scans = self.scan_all()
        by_name, _ = self._authority_index()
        stats: Dict[int, Dict[str, Any]] = {}
        unresolved: Counter = Counter()

        for s in scans:
            matched: Dict[int, Dict[str, Any]] = {}
            for raw in s.spatial:
                record = by_name.get(normalize_location_name(raw))
                if record is None:
                    unresolved[raw] += 1
                    continue
                if record["type"] == "Lieux" and record["coords"]:
                    matched[record["o_id"]] = record
            for o_id, record in matched.items():
                st = stats.get(o_id)
                if st is None:
                    st = stats[o_id] = {
                        "o_id": o_id,
                        "name": record["name"],
                        "lat": record["coords"][0],
                        "lng": record["coords"][1],
                        "items": 0,
                        "tagged": 0,
                        "by_frame": Counter(),
                        "by_country": Counter(),
                        "by_subset": Counter(),
                        "by_decade": Counter(),
                        "first_year": s.year,
                        "last_year": s.year,
                    }
                st["items"] += 1
                if s.is_tagged:
                    st["tagged"] += 1
                for frame, n in s.frame_counts.items():
                    if n:
                        st["by_frame"][frame] += 1
                for country in s.countries:
                    st["by_country"][country] += 1
                st["by_subset"][s.subset] += 1
                decade = self._decade(s.year)
                if decade:
                    st["by_decade"][decade] += 1
                if s.year:
                    lo, hi = st["first_year"], st["last_year"]
                    st["first_year"] = s.year if lo is None else min(lo, s.year)
                    st["last_year"] = s.year if hi is None else max(hi, s.year)

        places = [{
            "o_id": st["o_id"], "name": st["name"],
            "lat": st["lat"], "lng": st["lng"],
            "items": st["items"], "tagged": st["tagged"],
            "first_year": st["first_year"], "last_year": st["last_year"],
            "by_frame": dict(st["by_frame"]),
            "by_country": dict(st["by_country"]),
            "by_subset": dict(st["by_subset"]),
            "by_decade": dict(st["by_decade"]),
        } for st in stats.values() if st["items"] >= self.min_place_items]
        places.sort(key=lambda p: (-p["items"], p["name"]))

        self.logger.info(
            f"  places: {len(places)} geocoded places clear "
            f"{self.min_place_items} items ({len(unresolved)} spatial strings "
            "unresolved or ungeocoded)")
        return {
            "generated_at": generate_timestamp(),
            "min_items": self.min_place_items,
            "frames": list(self.lex.frames),
            "places": places,
            "unresolved_total": len(unresolved),
            "note": (
                "Places tagged on dossier items, counted once per item. A "
                "place appears only when the index holds coordinates for it, "
                "so this maps what is catalogued, not everything mentioned."
            ),
        }

    def build_references(self) -> Dict[str, Any]:
        """The scholarship on laïcité in the collection (view 11).

        Closes the loop between what the sources said and what has been
        written about them. Reported on its own axis throughout, because a
        reference's date is the date of the analysis, not of the events.
        """
        scans = self.scan_all()
        refs = [s for s in scans if s.subset == "references"]

        by_year: Counter = Counter()
        by_type: Counter = Counter()
        by_language: Counter = Counter()
        by_country: Counter = Counter()
        items: List[Dict[str, Any]] = []

        for s in refs:
            extra = s.extra or {}
            languages = [lang for lang in extra.get("languages", []) if lang]
            kind = extra.get("resource_class") or ""
            if s.year:
                by_year[s.year] += 1
            if kind:
                by_type[kind] += 1
            for lang in languages:
                by_language[lang] += 1
            for country in s.countries:
                by_country[country] += 1
            items.append({
                "o_id": s.o_id,
                "title": s.title,
                "author": extra.get("author", ""),
                "year": s.year,
                "type": kind,
                "languages": languages,
                "countries": s.countries,
                "occurrences": sum(s.frame_counts.values()),
                "tagged": s.is_tagged,
            })

        items.sort(key=lambda r: (-(r["year"] or 0), r["title"]))
        years = sorted(by_year)
        self.logger.info(
            f"  references: {len(items)} works, {len(by_type)} types, "
            f"{len(by_language)} languages")
        return {
            "generated_at": generate_timestamp(),
            "count": len(items),
            "tagged": sum(1 for r in items if r["tagged"]),
            "years": years,
            "by_year": [by_year[y] for y in years],
            "by_type": dict(by_type.most_common()),
            "by_language": dict(by_language.most_common()),
            "by_country": dict(by_country.most_common()),
            "items": items,
            "note": (
                "Dated by publication of the analysis, never by the period "
                "analysed — this axis is not comparable with the timeline."
            ),
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

        # Phase 2 — corpus linguistics. Each is lazy-loaded by its own view.
        save_json(self.build_collocates(),
                  self.output_dir / "laicite-collocates.json", minify=True)
        save_json(self.build_implicit(),
                  self.output_dir / "laicite-implicit.json", minify=self.minify)
        save_json(self.build_corpora(),
                  self.output_dir / "laicite-corpora.json", minify=self.minify)
        save_json(self.build_seasonality(),
                  self.output_dir / "laicite-seasonality.json", minify=self.minify)

        # Phase 3 — context. Same lazy-load contract as Phase 2: each is
        # fetched only when its view first activates.
        save_json(self.build_actors(),
                  self.output_dir / "laicite-actors.json", minify=True)
        save_json(self.build_arenas(),
                  self.output_dir / "laicite-arenas.json", minify=True)
        save_json(self.build_sentiment(),
                  self.output_dir / "laicite-sentiment.json", minify=True)
        save_json(self.build_places(),
                  self.output_dir / "laicite-places.json", minify=True)
        save_json(self.build_semantic(),
                  self.output_dir / "laicite-semantic.json", minify=True)
        save_json(self.build_circulation(),
                  self.output_dir / "laicite-circulation.json", minify=True)
        save_json(self.build_bylines(),
                  self.output_dir / "laicite-bylines.json", minify=self.minify)
        save_json(self.build_references(),
                  self.output_dir / "laicite-references.json", minify=True)

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
    parser.add_argument(
        "--top-collocates",
        type=int,
        default=40,
        help="Collocates kept per slice (default: %(default)s).",
    )
    parser.add_argument(
        "--min-collocate-count",
        type=int,
        default=8,
        help="Minimum in-window occurrences for a global collocate "
             "(default: %(default)s).",
    )
    parser.add_argument(
        "--min-slice-count",
        type=int,
        default=5,
        help="Minimum occurrences for a per-decade / per-country / per-corpus "
             "collocate (default: %(default)s).",
    )
    parser.add_argument(
        "--min-document-frequency",
        type=int,
        default=3,
        help="Drop collocates confined to fewer than this many distinct "
             "documents - kills scanner watermarks and one-off OCR noise "
             "without touching domain vocabulary (default: %(default)s).",
    )
    parser.add_argument(
        "--min-newspaper-items",
        type=int,
        default=5,
        help="Drop newspapers with fewer dossier items from the fingerprint "
             "and sentiment views (default: %(default)s).",
    )
    parser.add_argument(
        "--min-actor-items",
        type=int,
        default=4,
        help="Drop authority records co-occurring with fewer dossier items "
             "from the actors view (default: %(default)s).",
    )
    parser.add_argument(
        "--min-place-items",
        type=int,
        default=3,
        help="Drop geocoded places tagged on fewer dossier items from the "
             "map (default: %(default)s).",
    )
    parser.add_argument(
        "--min-byline-items",
        type=int,
        default=3,
        help="Drop bylines signing fewer dossier articles from the bylines "
             "view (default: %(default)s).",
    )
    add_standard_args(parser, minify_default=False)
    args = parse_standard_args(parser)
    LaiciteGenerator(
        output_dir=Path(args.output_dir),
        repo_id=args.repo,
        minify=args.minify,
        max_snippets=args.max_snippets,
        min_country_items=args.min_country_items,
        top_collocates=args.top_collocates,
        min_collocate_count=args.min_collocate_count,
        min_slice_count=args.min_slice_count,
        min_document_frequency=args.min_document_frequency,
        min_newspaper_items=args.min_newspaper_items,
        min_actor_items=args.min_actor_items,
        min_place_items=args.min_place_items,
        min_byline_items=args.min_byline_items,
    ).run()


if __name__ == "__main__":
    main()
