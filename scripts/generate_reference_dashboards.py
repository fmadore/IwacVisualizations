#!/usr/bin/env python3
"""
generate_reference_dashboards.py
================================

One dashboard JSON per row of the ``references`` subset, written to
``asset/data/reference-dashboards/{o_id}.json`` and consumed by the
``reference`` resource-page partial through
``asset/js/charts/reference-dashboard.js``.

References were the last content type with no per-item Visualizations
surface, for a good reason: until the 2026-07 pipeline they carried only
bibliographic metadata, which Omeka's own item page already displays
better than a chart could. They now carry extracted full text
(``OCR``), an ``embedding_OCR`` from the same model as the articles, their
own LDA topics and ``nb_mots`` — enough for a dashboard that adds
something the item page cannot.

Each file carries:

  * ``metrics``            — type / authors / year / publisher / pages /
                             language / words / DOI / topic label, for
                             the stat-card row. Missing values are
                             ``None`` and the front-end elides the card.
  * ``activity``           — the bibliography's publications per year,
                             zero-filled across the span, with this
                             work's year highlighted. Whole-subset rather
                             than per-publisher: publisher values are too
                             sparse here for a per-imprint run to mean
                             anything.
  * ``semantic_neighbors`` — top-K works from the bibliography by cosine
                             similarity over ``embedding_OCR``.
  * ``press_neighbors``    — top-K *newspaper articles* by cosine
                             similarity, the reverse of the bridge the
                             article dashboards added: from a scholarly
                             work to the press coverage it resembles.
                             Same 768-dim ``gemini-embedding-2`` space on
                             both sides.
  * ``reviews``            — the ``bibo:reviewOf`` relation, resolved
                             both ways: what this work reviews, and which
                             works in the bibliography review it. Title
                             matching is NFC + case-folded; unmatched
                             targets are still reported as plain text, so
                             a review of a book the collection does not
                             hold still says what it reviews.

Coverage is partial by nature (~423 of 867 references have text), so every
block is independently omittable and the front-end elides the slots it
doesn't get.

Usage
-----
    python scripts/generate_reference_dashboards.py
    python scripts/generate_reference_dashboards.py --limit 5 -v
    python scripts/generate_reference_dashboards.py --top-k-press 8

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset
               is the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from iwac_embeddings import build_normalized_matrix, top_k_cosine
from iwac_utils import (
    DATASET_ID,
    add_standard_args,
    canonicalize_country_field,
    clean_float,
    clean_str,
    extract_year,
    find_column,
    load_dataset_safe,
    parse_pipe_separated,
    parse_standard_args,
    save_json,
)

logger = logging.getLogger("generate_reference_dashboards")

REFERENCES_SUBSET = "references"
ARTICLES_SUBSET = "articles"

# Neighbour caps. The bibliography is small (867 rows, ~423 embedded), so
# ten scholarly neighbours already reaches into weak matches; the press
# side has 12k candidates and can afford the same.
DEFAULT_TOP_K_SEMANTIC = 10
DEFAULT_TOP_K_PRESS = 10

# Columns pulled from `articles` for the reverse bridge. Deliberately
# minimal: this generator has no use for OCR or lemmas, and materialising
# them for 12k rows is the expensive part of loading the subset.
ARTICLE_COLUMNS = ["o:id", "title", "newspaper", "country", "pub_date",
                   "thumbnail", "embedding_OCR"]


def _fold(value: Any) -> str:
    """NFC + case-folded key for title matching (review_of resolution)."""
    text = clean_str(value)
    if not text:
        return ""
    return unicodedata.normalize("NFC", text).casefold().strip()


class ReferenceDashboardGenerator:
    """Build one dashboard JSON per bibliographic reference."""

    def __init__(
        self,
        output_dir: Path,
        repo_id: str = DATASET_ID,
        limit: Optional[int] = None,
        top_k_semantic: int = DEFAULT_TOP_K_SEMANTIC,
        top_k_press: int = DEFAULT_TOP_K_PRESS,
        minify: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.repo_id = repo_id
        self.limit = limit or None
        self.top_k_semantic = top_k_semantic
        self.top_k_press = top_k_press
        self.minify = minify

        self.df = None
        self.articles_df = None

        self.meta: Dict[int, Dict[str, Any]] = {}
        self.target_ids: List[int] = []
        self.row_to_id: Dict[int, int] = {}
        self.year_counts: Counter = Counter()

        # review_of resolution
        self.title_to_id: Dict[str, int] = {}
        self.reviewed_by: Dict[int, List[Dict[str, Any]]] = defaultdict(list)

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------

    def load(self) -> None:
        logger.info("Loading references subset…")
        self.df = load_dataset_safe(REFERENCES_SUBSET, repo_id=self.repo_id)
        if self.df is None or self.df.empty:
            raise RuntimeError("references subset returned empty — aborting")
        logger.info("  %d references", len(self.df))

    def load_articles(self) -> None:
        """Articles are optional: without them the press-neighbour slot is
        simply absent, which is the same outcome as an un-embedded corpus."""
        if self.top_k_press <= 0:
            return
        logger.info("Loading articles subset for the reverse press bridge…")
        self.articles_df = load_dataset_safe(
            ARTICLES_SUBSET, repo_id=self.repo_id, columns=ARTICLE_COLUMNS,
        )
        if self.articles_df is None or self.articles_df.empty:
            logger.warning("  articles subset unavailable — press neighbours skipped")
            self.articles_df = None
            return
        logger.info("  %d articles", len(self.articles_df))

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def build_meta(self) -> None:
        df = self.df
        cols = {
            "id":        find_column(df, ["o:id", "id"]),
            "title":     find_column(df, ["title", "dcterms:title"]),
            "author":    find_column(df, ["author"]),
            "editor":    find_column(df, ["editor"]),
            "type":      find_column(df, ["o:resource_class", "type"]),
            "publisher": find_column(df, ["publisher"]),
            "date":      find_column(df, ["pub_date", "dcterms:date"]),
            "language":  find_column(df, ["language"]),
            "country":   find_column(df, ["country"]),
            "pages":     find_column(df, ["nb_pages", "pages"]),
            "words":     find_column(df, ["nb_mots"]),
            "doi":       find_column(df, ["doi"]),
            "abstract":  find_column(df, ["abstract"]),
            "topic":     find_column(df, ["lda_topic_label"]),
            "model":     find_column(df, ["lda_model_name"]),
            "review_of": find_column(df, ["review_of"]),
            "thumbnail": find_column(df, ["thumbnail"]),
        }
        if not cols["id"]:
            raise RuntimeError("references subset has no o:id column")

        for row_idx, row in df.iterrows():
            try:
                ref_id = int(row.get(cols["id"]))
            except (TypeError, ValueError):
                continue

            date = clean_str(row.get(cols["date"])) if cols["date"] else ""
            year = extract_year(date)
            authors = [a for a in parse_pipe_separated(row.get(cols["author"]))
                       if a] if cols["author"] else []
            if not authors and cols["editor"]:
                authors = [a for a in parse_pipe_separated(row.get(cols["editor"])) if a]
            languages = parse_pipe_separated(row.get(cols["language"])) if cols["language"] else []
            pages = clean_float(row.get(cols["pages"])) if cols["pages"] else None
            words = clean_float(row.get(cols["words"])) if cols["words"] else None

            self.meta[ref_id] = {
                "title":     clean_str(row.get(cols["title"])) if cols["title"] else "",
                "authors":   authors,
                "type":      clean_str(row.get(cols["type"])) if cols["type"] else "",
                "publisher": clean_str(row.get(cols["publisher"])) if cols["publisher"] else "",
                "date":      date,
                "year":      year,
                "language":  ", ".join(languages),
                "country":   canonicalize_country_field(row.get(cols["country"]))
                             if cols["country"] else "",
                "pages":     int(pages) if pages is not None else None,
                "words":     int(words) if words is not None else None,
                "doi":       clean_str(row.get(cols["doi"])) if cols["doi"] else "",
                "abstract":  clean_str(row.get(cols["abstract"])) if cols["abstract"] else "",
                "topic":     clean_str(row.get(cols["topic"])) if cols["topic"] else "",
                "model":     clean_str(row.get(cols["model"])) if cols["model"] else "",
                "review_of": clean_str(row.get(cols["review_of"])) if cols["review_of"] else "",
                "thumbnail": clean_str(row.get(cols["thumbnail"])) if cols["thumbnail"] else "",
            }
            self.row_to_id[row_idx] = ref_id
            self.target_ids.append(ref_id)
            if year is not None:
                self.year_counts[year] += 1

            key = _fold(self.meta[ref_id]["title"])
            # First title wins on a collision: two distinct works sharing a
            # title exactly is rare enough that guessing between them would
            # be worse than linking the earlier one deterministically.
            if key and key not in self.title_to_id:
                self.title_to_id[key] = ref_id

        # Second pass — the inverse review relation needs the title index
        # complete before it can resolve anything.
        resolved = 0
        for ref_id, meta in self.meta.items():
            target = meta.get("review_of")
            if not target:
                continue
            target_id = self.title_to_id.get(_fold(target))
            if target_id is None or target_id == ref_id:
                continue
            self.reviewed_by[target_id].append({
                "o_id":  ref_id,
                "title": meta["title"],
                "authors": meta["authors"][:3],
                "date":  meta["date"][:10],
            })
            resolved += 1

        logger.info("  %d references with metadata", len(self.meta))
        n_reviews = sum(1 for m in self.meta.values() if m.get("review_of"))
        logger.info(
            "  reviewOf: %d reviews, %d resolved to a work held in the bibliography",
            n_reviews, resolved,
        )

    # ------------------------------------------------------------------
    # Neighbours
    # ------------------------------------------------------------------

    def compute_semantic_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K bibliography neighbours per reference."""
        result: Dict[int, List[Dict[str, Any]]] = {}
        if "embedding_OCR" not in self.df.columns:
            logger.warning("references subset has no embedding_OCR — scholarly "
                           "neighbours skipped")
            return result

        X, valid = build_normalized_matrix(self.df, "embedding_OCR")
        if X.shape[0] < 2:
            logger.warning("fewer than two usable reference embeddings — "
                           "scholarly neighbours skipped")
            return result

        neighbours = top_k_cosine(X, valid, self.top_k_semantic)
        for i, row_position in enumerate(valid):
            ref_id = self.row_to_id.get(self.df.index[row_position])
            if ref_id is None:
                continue
            cards: List[Dict[str, Any]] = []
            for matrix_idx, sim in neighbours[i]:
                if sim <= 0.0:
                    continue
                neigh_id = self.row_to_id.get(self.df.index[valid[matrix_idx]])
                meta = self.meta.get(neigh_id) if neigh_id is not None else None
                if not meta:
                    continue
                cards.append({
                    "o_id":       neigh_id,
                    "title":      meta["title"],
                    "authors":    meta["authors"][:3],
                    "type":       meta["type"],
                    "date":       meta["date"][:10],
                    "thumbnail":  meta["thumbnail"],
                    "similarity": round(sim, 4),
                })
            if cards:
                result[ref_id] = cards

        logger.info("Scholarly neighbours computed for %d/%d references",
                    len(result), len(self.meta))
        return result

    def compute_press_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K newspaper articles per reference — the reverse bridge.

        Same caveat as the forward direction on the article dashboards: a
        chunk-averaged book embedding sits nearer the corpus centroid than
        any single article does, so these are leads, not citations. Here the
        asymmetry works in the reader's favour, though — one long work
        against 12k short articles produces a ranking over the press, which
        is exactly the "what did the papers say about this" question.
        """
        result: Dict[int, List[Dict[str, Any]]] = {}
        if self.articles_df is None or "embedding_OCR" not in self.df.columns:
            return result
        if "embedding_OCR" not in self.articles_df.columns:
            logger.warning("articles subset has no embedding_OCR — press "
                           "neighbours skipped")
            return result

        R, ref_valid = build_normalized_matrix(self.df, "embedding_OCR")
        A, art_valid = build_normalized_matrix(self.articles_df, "embedding_OCR")
        if R.shape[0] == 0 or A.shape[0] == 0:
            return result
        if R.shape[1] != A.shape[1]:
            logger.warning(
                "Embedding dimensionality differs (references %d, articles %d) — "
                "refusing to compare across subsets", R.shape[1], A.shape[1],
            )
            return result

        id_col = find_column(self.articles_df, ["o:id", "id"])
        title_col = find_column(self.articles_df, ["title"])
        paper_col = find_column(self.articles_df, ["newspaper", "source"])
        country_col = find_column(self.articles_df, ["country"])
        date_col = find_column(self.articles_df, ["pub_date"])
        thumb_col = find_column(self.articles_df, ["thumbnail"])

        K = min(self.top_k_press, A.shape[0])
        sims = R @ A.T                     # (refs, articles) — 423 × 12k
        k_eff = min(K, sims.shape[1])
        part_idx = np.argpartition(-sims, k_eff - 1, axis=1)[:, :k_eff]
        part_sims = np.take_along_axis(sims, part_idx, axis=1)
        order = np.argsort(-part_sims, axis=1)
        top_idx = np.take_along_axis(part_idx, order, axis=1)
        top_sims = np.take_along_axis(part_sims, order, axis=1)

        for i, row_position in enumerate(ref_valid):
            ref_id = self.row_to_id.get(self.df.index[row_position])
            if ref_id is None:
                continue
            cards: List[Dict[str, Any]] = []
            for rank in range(k_eff):
                art_matrix_idx = int(top_idx[i, rank])
                sim = float(top_sims[i, rank])
                if sim <= 0.0:
                    continue
                art_row = self.articles_df.iloc[art_valid[art_matrix_idx]]
                try:
                    art_id = int(art_row.get(id_col))
                except (TypeError, ValueError):
                    continue
                cards.append({
                    "o_id":       art_id,
                    "title":      clean_str(art_row.get(title_col)) if title_col else "",
                    "newspaper":  clean_str(art_row.get(paper_col)) if paper_col else "",
                    "country":    canonicalize_country_field(art_row.get(country_col))
                                  if country_col else "",
                    "date":       clean_str(art_row.get(date_col))[:10] if date_col else "",
                    "thumbnail":  clean_str(art_row.get(thumb_col)) if thumb_col else "",
                    "similarity": round(sim, 4),
                })
            if cards:
                result[ref_id] = cards

        logger.info("Press neighbours computed for %d/%d references",
                    len(result), len(self.meta))
        return result

    # ------------------------------------------------------------------
    # Assembly
    # ------------------------------------------------------------------

    def build_activity(self, meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Whole-bibliography publications-per-year, this work highlighted."""
        if not self.year_counts:
            return None
        y_min, y_max = min(self.year_counts), max(self.year_counts)
        if y_max <= y_min:
            return None
        years = list(range(y_min, y_max + 1))
        highlight = meta.get("year")
        return {
            "years":     years,
            "values":    [self.year_counts.get(y, 0) for y in years],
            "highlight": highlight if highlight in self.year_counts else None,
            "total":     int(sum(self.year_counts.values())),
        }

    def build_reviews(self, ref_id: int, meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """The reviewOf relation in both directions, or None if neither."""
        out: Dict[str, Any] = {}
        target = meta.get("review_of")
        if target:
            target_id = self.title_to_id.get(_fold(target))
            entry: Dict[str, Any] = {"title": target}
            # Unresolved targets stay as plain text: a review of a book the
            # collection doesn't hold should still say what it reviews.
            if target_id is not None and target_id != ref_id:
                entry["o_id"] = target_id
            out["reviews"] = entry
        incoming = self.reviewed_by.get(ref_id) or []
        if incoming:
            out["reviewed_by"] = incoming
        return out or None

    def generate_all(
        self,
        scholarly: Dict[int, List[Dict[str, Any]]],
        press: Dict[int, List[Dict[str, Any]]],
    ) -> int:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = self.target_ids[: self.limit] if self.limit else self.target_ids
        written = 0
        for ref_id in targets:
            meta = self.meta[ref_id]
            data: Dict[str, Any] = {
                "o_id":  ref_id,
                "title": meta["title"],
                "metrics": {
                    "type":      meta["type"] or None,
                    "authors":   ", ".join(meta["authors"]) or None,
                    "year":      meta["year"],
                    "publisher": meta["publisher"] or None,
                    "pages":     meta["pages"],
                    "words":     meta["words"],
                    "language":  meta["language"] or None,
                    "country":   meta["country"] or None,
                    "doi":       meta["doi"] or None,
                    "topic":     meta["topic"] or None,
                    # The two reference LDA models share the lda_* columns,
                    # so a topic label is only interpretable alongside the
                    # model that produced it.
                    "topic_model": meta["model"] or None,
                },
                "activity": self.build_activity(meta),
            }
            if meta["abstract"]:
                data["abstract"] = meta["abstract"]
            neighbours = scholarly.get(ref_id)
            if neighbours:
                data["semantic_neighbors"] = neighbours
            press_cards = press.get(ref_id)
            if press_cards:
                data["press_neighbors"] = press_cards
            reviews = self.build_reviews(ref_id, meta)
            if reviews:
                data["reviews"] = reviews

            save_json(data, self.output_dir / f"{ref_id}.json",
                      minify=self.minify, log=False)
            written += 1
            if written % 200 == 0:
                logger.info("  %d reference JSONs written", written)
        logger.info("Done — %d reference JSONs written to %s", written, self.output_dir)
        return written

    def run(self) -> int:
        self.load()
        self.load_articles()
        self.build_meta()
        scholarly = self.compute_semantic_neighbors()
        press = self.compute_press_neighbors()
        return self.generate_all(scholarly, press)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "reference-dashboards",
        help="Where to write per-reference JSON files (default: %(default)s)",
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="Only emit the first N references (smoke tests)")
    parser.add_argument("--top-k-semantic", type=int, default=DEFAULT_TOP_K_SEMANTIC,
                        help="Scholarly neighbours per reference (default: %(default)s)")
    parser.add_argument("--top-k-press", type=int, default=DEFAULT_TOP_K_PRESS,
                        help="Newspaper articles per reference; 0 skips loading the "
                             "articles subset entirely (default: %(default)s)")
    add_standard_args(parser, minify_default=True)
    args = parse_standard_args(parser)

    gen = ReferenceDashboardGenerator(
        output_dir=args.output_dir,
        repo_id=args.repo,
        limit=args.limit if args.limit and args.limit > 0 else None,
        top_k_semantic=args.top_k_semantic,
        top_k_press=args.top_k_press,
        minify=args.minify,
    )
    written = gen.run()
    logger.info("Finished: %d reference dashboards emitted", written)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
