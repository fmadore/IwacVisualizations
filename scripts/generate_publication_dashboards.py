"""Generate per-issue dashboard JSONs for the IWAC ``publications`` subset.

One JSON per ``publications`` row (Islamic periodical issues —
``bibo:Issue``, resource template 21 on islam.zmo.de), written to
``asset/data/publication-dashboards/{o_id}.json`` and consumed by the
``publication`` resource-page partial through
``asset/js/charts/publication-dashboard.js``.

Each file carries three blocks:

  * ``metrics``            — words / pages / issue number / language /
                             country / date, for the stat-card row.
                             Missing values are ``None`` and the
                             front-end elides those cards.
  * ``run``                — the issue's periodical run: issues-per-year
                             for the same ``newspaper`` (the periodical
                             title in this subset), zero-filled across
                             the run's year span, with this issue's year
                             as the sparkline highlight. Unlike the
                             audiovisual ``medium`` caveat that keeps
                             the minimal-item dashboards on whole-subset
                             siblings, ``newspaper`` is clean here, so
                             the per-periodical slice is honest.
  * ``run_neighbors``      — up to 8 issues of the SAME periodical,
                             chronologically closest to this one
                             (prev/next browsing). No similarity score;
                             the shared similar-items renderer handles
                             score-less cards natively.
  * ``semantic_neighbors`` — top-K issues by cosine similarity over
                             ``embedding_tableOfContents`` (768-dim
                             Gemini), in the exact card shape the shared
                             similar-items renderer consumes
                             (``o_id / title / newspaper / country /
                             date / thumbnail / similarity``). Same kNN
                             recipe as ``generate_article_dashboards.py``
                             — N is only 1,501 so the similarity matrix
                             fits comfortably in one shot.

                             Data reality check (2026-06): the live
                             dataset carries a ``tableOfContents`` for
                             only 4 of 1,501 issues, so this block is
                             empty almost everywhere today. It is wired
                             anyway because the front-end slot elides
                             when empty and lights up automatically as
                             the upstream ToC pipeline progresses —
                             ``run_neighbors`` is the panel that works
                             for every issue right now.

Usage
-----
    python scripts/generate_publication_dashboards.py
    python scripts/generate_publication_dashboards.py --limit 5 -v
    python scripts/generate_publication_dashboards.py --top-k-semantic 10
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from iwac_utils import (
    DATASET_ID,
    clean_float,
    clean_str,
    configure_logging,
    extract_year,
    find_column,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

logger = logging.getLogger("generate_publication_dashboards")

PUBLICATIONS_SUBSET = "publications"

# Ten neighbour cards is what the article dashboards ship and what the
# shared similar-items renderer paginates comfortably.
DEFAULT_TOP_K_SEMANTIC = 10


class PublicationDashboardGenerator:
    """Build one dashboard JSON per periodical issue."""

    def __init__(
        self,
        output_dir: Path,
        repo_id: str = DATASET_ID,
        limit: Optional[int] = None,
        top_k_semantic: int = DEFAULT_TOP_K_SEMANTIC,
        minify: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.repo_id = repo_id
        self.limit = limit if limit else None
        self.top_k_semantic = top_k_semantic
        self.minify = minify

        self.df = None  # publications DataFrame

        # o_id -> metadata dict (also reused for neighbour cards).
        self.meta: Dict[int, Dict[str, Any]] = {}
        # row index -> o_id and back, for slicing the embedding matrix.
        self.row_to_id: Dict[int, int] = {}
        # periodical title -> Counter({year: issue count})
        self.runs: Dict[str, Counter] = defaultdict(Counter)
        # periodical title -> issue o_ids in chronological order
        self.run_order: Dict[str, List[int]] = {}

        self.embedding_matrix: Optional[np.ndarray] = None
        self.valid_rows: Optional[np.ndarray] = None

        # Target issue ids in deterministic (row) order.
        self.target_ids: List[int] = []

    # ------------------------------------------------------------------
    # Load + per-row metadata
    # ------------------------------------------------------------------

    def load(self) -> None:
        logger.info("Loading publications subset (includes embedding_tableOfContents)...")
        self.df = load_dataset_safe(PUBLICATIONS_SUBSET, repo_id=self.repo_id)
        if self.df is None or self.df.empty:
            raise RuntimeError("publications subset returned empty — aborting")
        logger.info(f"  {len(self.df)} publication issues")

    def build_meta(self) -> None:
        df = self.df
        id_col        = find_column(df, ["o:id", "id"])
        title_col     = find_column(df, ["title", "dcterms:title", "Titre"])
        periodical_col = find_column(df, ["newspaper", "dcterms:publisher", "source"])
        date_col      = find_column(df, ["pub_date", "dcterms:date"])
        country_col   = find_column(df, ["country", "countries"])
        language_col  = find_column(df, ["language", "dcterms:language"])
        issue_col     = find_column(df, ["issue"])
        nb_pages_col  = find_column(df, ["nb_pages", "pages"])
        nb_mots_col   = find_column(df, ["nb_mots", "word_count"])
        thumbnail_col = find_column(df, ["thumbnail"])

        if not id_col:
            raise RuntimeError("publications subset has no o:id column")

        for row_idx, row in df.iterrows():
            try:
                pub_id = int(row.get(id_col))
            except (TypeError, ValueError):
                continue

            pub_date = clean_str(row.get(date_col)) if date_col else ""
            year = extract_year(pub_date)
            periodical = clean_str(row.get(periodical_col)) if periodical_col else ""

            languages = (
                parse_pipe_separated(row.get(language_col)) if language_col else []
            )
            # `issue` is pipe-separated for double issues ("48|49") —
            # join for display.
            issue_parts = (
                parse_pipe_separated(row.get(issue_col)) if issue_col else []
            )
            nb_pages = clean_float(row.get(nb_pages_col)) if nb_pages_col else None
            nb_mots = clean_float(row.get(nb_mots_col)) if nb_mots_col else None

            self.meta[pub_id] = {
                "title":      clean_str(row.get(title_col)) if title_col else "",
                "newspaper":  periodical,
                "country":    clean_str(row.get(country_col)) if country_col else "",
                "pub_date":   pub_date,
                "year":       year,
                "language":   ", ".join(languages),
                "issue":      ", ".join(issue_parts),
                "nb_pages":   int(nb_pages) if nb_pages is not None else None,
                "nb_mots":    int(nb_mots) if nb_mots is not None else None,
                "thumbnail":  clean_str(row.get(thumbnail_col)) if thumbnail_col else "",
            }
            self.row_to_id[row_idx] = pub_id
            self.target_ids.append(pub_id)

            if periodical and year:
                self.runs[periodical][year] += 1

        logger.info(
            f"  {len(self.meta)} issues across {len(self.runs)} periodicals"
        )

    def build_run_order(self) -> None:
        """Per-periodical chronological issue order (ISO date string,
        then o_id as the tiebreak; undated issues sort last) — feeds the
        prev/next "other issues of this periodical" strips."""
        by_periodical: Dict[str, List[int]] = defaultdict(list)
        for pub_id in self.target_ids:
            name = self.meta[pub_id]["newspaper"]
            if name:
                by_periodical[name].append(pub_id)
        for name, ids in by_periodical.items():
            ids.sort(key=lambda pid: (self.meta[pid]["pub_date"] or "9999", pid))
        self.run_order = dict(by_periodical)

    # ------------------------------------------------------------------
    # Semantic kNN over embedding_tableOfContents
    # ------------------------------------------------------------------

    def build_embedding_matrix(self) -> None:
        """Stack ``embedding_tableOfContents`` into an (N, 768) float32
        matrix, L2-normalized; invalid rows stay all-zero so they never
        surface as neighbours (cosine 0 against everything).
        """
        df = self.df
        embed_col = find_column(df, ["embedding_tableOfContents", "embedding"])
        if not embed_col:
            logger.warning(
                "No embedding_tableOfContents column — semantic neighbours "
                "will be empty for every issue."
            )
            self.valid_rows = np.zeros(len(df), dtype=bool)
            return

        N = len(df)
        dim: Optional[int] = None
        vectors: List[Optional[np.ndarray]] = []
        valid = np.zeros(N, dtype=bool)

        for i, value in enumerate(df[embed_col].values):
            vec = self._coerce_embedding(value)
            if vec is None:
                vectors.append(None)
                continue
            if dim is None:
                dim = len(vec)
            elif len(vec) != dim:
                vectors.append(None)
                continue
            vectors.append(vec)
            valid[i] = True

        if dim is None:
            logger.warning("embedding_tableOfContents contained no usable vectors")
            self.valid_rows = valid
            return

        X = np.zeros((N, dim), dtype=np.float32)
        for i, vec in enumerate(vectors):
            if vec is not None and len(vec) == dim:
                X[i] = vec

        norms = np.linalg.norm(X, axis=1, keepdims=True)
        safe_norms = np.where(norms == 0.0, 1.0, norms)
        X = X / safe_norms
        X[~valid] = 0.0

        self.embedding_matrix = X
        self.valid_rows = valid
        logger.info(
            f"Embedding matrix: {N} rows × {dim} dims, "
            f"{int(valid.sum())} valid, {N - int(valid.sum())} missing/invalid"
        )

    @staticmethod
    def _coerce_embedding(value: Any) -> Optional[np.ndarray]:
        if value is None:
            return None
        if isinstance(value, np.ndarray):
            if value.size == 0 or not np.isfinite(value).all():
                return None
            return value.astype(np.float32, copy=False)
        if isinstance(value, (list, tuple)):
            if not value:
                return None
            try:
                arr = np.asarray(value, dtype=np.float32)
            except (TypeError, ValueError):
                return None
            if arr.size == 0 or not np.isfinite(arr).all():
                return None
            return arr
        return None

    def compute_semantic_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K neighbour cards per issue. N=1,501 → the full (N, N)
        similarity matrix is ~9 MB float32; no batching needed.
        """
        result: Dict[int, List[Dict[str, Any]]] = {pid: [] for pid in self.target_ids}
        X = self.embedding_matrix
        valid = self.valid_rows
        if X is None or valid is None or not valid.any():
            return result

        K = self.top_k_semantic
        sims = X @ X.T  # (N, N)
        np.fill_diagonal(sims, -np.inf)

        k_eff = min(K, sims.shape[1] - 1)
        if k_eff <= 0:
            return result
        part_idx = np.argpartition(-sims, k_eff, axis=1)[:, :k_eff]
        part_sims = np.take_along_axis(sims, part_idx, axis=1)
        order = np.argsort(-part_sims, axis=1)
        top_idx = np.take_along_axis(part_idx, order, axis=1)
        top_sims = np.take_along_axis(part_sims, order, axis=1)

        for row in range(sims.shape[0]):
            if not valid[row]:
                continue
            pub_id = self.row_to_id.get(row)
            if pub_id is None:
                continue
            neighbours: List[Dict[str, Any]] = []
            for rank in range(k_eff):
                neigh_row = int(top_idx[row, rank])
                sim = float(top_sims[row, rank])
                if sim <= 0.0 or not valid[neigh_row]:
                    continue
                neigh_id = self.row_to_id.get(neigh_row)
                meta = self.meta.get(neigh_id) if neigh_id is not None else None
                if not meta:
                    continue
                neighbours.append({
                    "o_id":       neigh_id,
                    "title":      meta["title"],
                    "newspaper":  meta["newspaper"],
                    "country":    meta["country"],
                    "date":       meta["pub_date"],
                    "thumbnail":  meta["thumbnail"],
                    "similarity": round(sim, 4),
                })
            result[pub_id] = neighbours

        n_with = sum(1 for v in result.values() if v)
        logger.info(f"Semantic neighbours computed for {n_with}/{len(result)} issues")
        return result

    # ------------------------------------------------------------------
    # Per-issue run + JSON assembly
    # ------------------------------------------------------------------

    def build_run(self, meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Sibling-sparkline shape for the issue's periodical: zero-filled
        issues-per-year across the run's span. None when the periodical
        is unknown or the run has fewer than 2 distinct years (the
        sparkline renderer needs ≥ 2 points).
        """
        periodical = meta.get("newspaper") or ""
        counts = self.runs.get(periodical)
        if not counts:
            return None
        y_min, y_max = min(counts), max(counts)
        if y_max <= y_min:
            return None
        years = list(range(y_min, y_max + 1))
        values = [counts.get(y, 0) for y in years]
        highlight = meta.get("year")
        return {
            "newspaper": periodical,
            "years":     years,
            "values":    values,
            "highlight": highlight if highlight in counts else None,
            "total":     int(sum(counts.values())),
        }

    def build_run_neighbors(self, pub_id: int, cap: int = 8) -> List[Dict[str, Any]]:
        """Up to ``cap`` issues of the same periodical, picked by
        expanding outward from this issue's position in the run and
        returned in chronological order. The periodical name is omitted
        from the cards — every card in the strip shares it.
        """
        meta = self.meta[pub_id]
        ids = self.run_order.get(meta["newspaper"] or "", [])
        if len(ids) < 2:
            return []
        idx = ids.index(pub_id)
        picked: List[int] = []
        lo, hi = idx - 1, idx + 1
        while len(picked) < cap and (lo >= 0 or hi < len(ids)):
            if lo >= 0:
                picked.append(lo)
                lo -= 1
            if len(picked) < cap and hi < len(ids):
                picked.append(hi)
                hi += 1
        picked.sort()
        cards = []
        for i in picked:
            m = self.meta[ids[i]]
            cards.append({
                "o_id":      ids[i],
                "title":     m["title"],
                "date":      m["pub_date"],
                "thumbnail": m["thumbnail"],
            })
        return cards

    def generate_all(self, neighbours: Dict[int, List[Dict[str, Any]]]) -> int:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = self.target_ids[: self.limit] if self.limit else self.target_ids
        written = 0
        for pub_id in targets:
            meta = self.meta[pub_id]
            data = {
                "o_id":      pub_id,
                "title":     meta["title"],
                "newspaper": meta["newspaper"],
                "metrics": {
                    "words":    meta["nb_mots"],
                    "pages":    meta["nb_pages"],
                    "issue":    meta["issue"] or None,
                    "language": meta["language"] or None,
                    "country":  meta["country"] or None,
                    "date":     meta["pub_date"] or None,
                },
                "run": self.build_run(meta),
                "run_neighbors": self.build_run_neighbors(pub_id),
                "semantic_neighbors": neighbours.get(pub_id, []),
            }
            out_path = self.output_dir / f"{pub_id}.json"
            save_json(data, out_path, minify=self.minify, log=False)
            written += 1
            if written % 500 == 0:
                logger.info(f"  {written} issue JSONs written")
        logger.info(f"Done — {written} issue JSONs written to {self.output_dir}")
        return written

    def run(self) -> int:
        self.load()
        self.build_meta()
        self.build_run_order()
        self.build_embedding_matrix()
        neighbours = self.compute_semantic_neighbors()
        return self.generate_all(neighbours)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "publication-dashboards",
        help="Where to write per-issue JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repo id (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N issues (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "--top-k-semantic",
        type=int,
        default=DEFAULT_TOP_K_SEMANTIC,
        help="Semantic-neighbours cap per issue (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the JSON output (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()
    global logger
    logger = configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    gen = PublicationDashboardGenerator(
        output_dir=args.output_dir,
        repo_id=args.repo,
        limit=args.limit,
        top_k_semantic=args.top_k_semantic,
        minify=args.minify,
    )
    written = gen.run()
    return 0 if written > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
