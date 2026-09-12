"""The one pass over the five source subsets, and the records it produces.

``ItemScan`` is the shared input every builder in this package reads: one
row of one subset, its occurrences with character offsets, its rights flag,
its frames. ``ScanMixin.scan_all`` fills the list once per run — every
``build_*`` method elsewhere is a pure function of it plus the lexicon.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from iwac_utils import (
    SENTIMENT_FIELD_SUFFIXES,
    SENTIMENT_MODELS,
    STOPWORDS,
    clean_float,
    extract_month_num,
    extract_year,
    iter_records,
    load_dataset_safe,
    normalize_country,
    parse_pipe_separated,
    resolve_sentiment_columns,
    sentiment_columns,
)

from laicite.lexicon import (
    ASCII_TOKEN_RE, COLLOCATE_WINDOW, MIN_TOKEN_LEN,
    fold_plain, fold_preserving,
)
from laicite.register import _register_add, _register_bucket


# Per-subset text fields, in scan order: (column, is_public_column).
# `is_public_column` False means the field is `OCR` and rides the rights
# gate; True means the column is public on the Hub and is always quotable.
SUBSET_FIELDS: Dict[str, List[Tuple[str, bool]]] = {
    "articles":     [("title", True), ("OCR", False)],
    "publications": [("title", True), ("OCR", False)],
    "documents":    [("title", True), ("OCR", False)],
    "audiovisual":  [("title", True), ("OCR", False)],
    "references":   [("title", True), ("OCR", False)],
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
        # The per-model AI sentiment (view 9). load_dataset_safe keeps
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
    "audiovisual": [
        "o:id", "title", "country", "pub_date", "subject", "spatial",
        "language", "OCR", "OCR_is_public", "nb_mots", "iwac_url",
        "source_type", "hijri_month", "URL",
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
    "audiovisual": "primary",
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
    "audiovisual": 6,
}


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
    #: Unfiltered word tokens in exactly the fields searched, for density.
    analyzed_words: int = 0
    nearby_frame_counts: Dict[str, int] = field(default_factory=dict)
    unresolved_hits: int = 0

    @property
    def said(self) -> bool:
        """Does the item use the dossier's own vocabulary at all?"""
        return self.membership_hits > 0


class ScanMixin:
    """``LaiciteGenerator``'s scan half. Mixed in by ``laicite.generator``."""


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
            if subset == "audiovisual":
                if "source_type" not in df.columns:
                    raise RuntimeError("YouTube selection requires source_type")
                df = df[df["source_type"] == "youtube"]
            self.subset_totals[subset] = len(df)
            self.subset_fulltext[subset] = int(
                df["OCR"].fillna("").str.strip().ne("").sum()
            ) if "OCR" in df.columns else 0
            if "OCR_is_public" in df.columns:
                self.subset_public[subset] = int(df["OCR_is_public"].fillna(False).sum())
            else:
                self.subset_public[subset] = 0
            if subset == "articles":
                self._sentiment_cols = resolve_sentiment_columns(df)

            self.logger.info(f"Scanning '{subset}' ({len(df)} rows)…")
            members = 0
            for row in iter_records(df):
                if subset == "articles":
                    self._tally_baseline_sentiment(row)
                rec = self._scan_row(row, subset, fields, tag_folded)
                self._observe_source(row, subset, rec)
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
        unresolved_hits = 0
        texts: Dict[str, str] = {}
        # Token index of every membership-frame hit, per field, so the
        # collocate windows can be cut after the whole field is scanned.
        hit_token_idx: Dict[str, List[int]] = defaultdict(list)
        field_tokens: Dict[str, List[str]] = {}
        positions = {}

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
            positions[column] = token_at
            quotable = is_public_column or ocr_public

            for frame, pattern in self.lex.patterns.items():
                ambiguous_forms = self.lex.ambiguous.get(frame, set())
                for m in pattern.finditer(folded):
                    span = (m.start(), m.end())
                    # Categories are independent: "école laïque" supplies
                    # both membership and schooling evidence. Suppressing
                    # overlap across categories erased the schooling hit.
                    # finditer still avoids duplicates within one category.
                    surface = m.group(0)
                    if surface in ambiguous_forms:
                        idx = token_at.get(m.start())
                        if idx is not None:
                            sense = self.lex.classify_ambiguous(tokens, idx)
                            if sense == "unresolved":
                                unresolved_hits += 1
                                continue
                            if sense == "laity":
                                laity_demoted += 1
                                self.laity_by_subset[subset] += 1
                                continue
                        self.state_by_subset[subset] += 1
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
            analyzed_words=sum(len(tokens) for tokens in field_tokens.values()),
            unresolved_hits=unresolved_hits,
            nearby_frame_counts=dict(Counter(o.frame for o in occurrences
                if o.frame not in self.lex.membership_frames and any(
                    abs(positions[o.field].get(o.start, -10000) - anchor) <= 80
                    for anchor in hit_token_idx.get(o.field, [])))),
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
        elif subset == "audiovisual":
            rec.extra = {"url": str(row.get("URL") or "").strip()}
        rec.extra["languages"] = parse_pipe_separated(row.get("language"))
        self.texts[(subset, rec.o_id)] = texts
        return rec

    def _row_sentiment(self, row: pd.Series) -> Dict[str, Any]:
        """Pull the per-model AI sentiment off one `articles` row.

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
                t for t in ASCII_TOKEN_RE.findall(fold_plain(title))
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
        for i, m in enumerate(ASCII_TOKEN_RE.finditer(folded)):
            tokens.append(m.group(0))
            token_at[m.start()] = i
        return tokens, token_at
