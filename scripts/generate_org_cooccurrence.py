#!/usr/bin/env python3
"""
generate_org_cooccurrence.py
============================

Generate ``asset/data/org-cooccurrence.json`` for the IwacVisualizations
"Islamic Organisations Co-occurrence Matrix" page block (GitHub issue #1).

For each organisation curated in ``scripts/org_cooccurrence_targets.json``,
scan every article in the IWAC ``articles`` subset and slide a
±``window_size``-token window around every occurrence of one of the
organisation's target surface forms (canonical name + acronym + aliases).
Content words inside the window form the organisation's *discursive
neighbourhood*; the matrix cell (a, b) counts the articles where both
context words appeared in some window around the organisation's name.

Filters on context words: length > 2, alphabetic, not in the shared
French stop-list (``iwac_utils.STOPWORDS`` — grammar only, never
Islamic-domain terms per repo CLAUDE.md), and not a target form itself.
Multi-word targets are handled by joining the phrase with underscores
before tokenization so the single-token window logic applies. No
lemmatization — matches the reference sliding-window pattern and keeps
false positives predictable.

Output shape (single bundle; the six 30×30 matrices are small):

    {
      "generated_at": …, "window_size": 50, "top_n_terms": 30,
      "min_cooccurrence": 2,
      "orgs": [ { id, name, acronym, country, o_id,
                  total_articles, vocabulary_size, year_range }, … ],
      "matrices": { org_id: { terms, matrix, max_cooccurrence,
                              total_articles, term_counts } }
    }

Usage
-----
    python scripts/generate_org_cooccurrence.py
    python scripts/generate_org_cooccurrence.py --window-size 50 --top-n-terms 30
    python scripts/generate_org_cooccurrence.py --min-cooccurrence 3
"""
from __future__ import annotations

import argparse
import json
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set

from iwac_utils import (
    DATASET_ID,
    STOPWORDS,
    configure_logging,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    save_json,
)

DEFAULT_TARGETS_FILE = Path(__file__).parent / "org_cooccurrence_targets.json"

# Tokens are split on non-word runs; keep it dumb and predictable (the
# reference kernel split on whitespace — \W+ additionally sheds the
# punctuation glued to words in OCR text).
_SPLIT_RE = re.compile(r"[^\w]+", re.UNICODE)


def load_targets(path: Path) -> List[Dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    orgs = data.get("orgs") or []
    if not orgs:
        raise RuntimeError(f"No orgs defined in {path}")
    for org in orgs:
        if not org.get("id") or not org.get("targets"):
            raise RuntimeError(f"Org entry missing id/targets in {path}: {org}")
    return orgs


def scan_article_windows(
    words: List[str],
    targets: Set[str],
    stopwords: Set[str],
    window_size: int,
    exclude: Set[str],
) -> Set[str]:
    """Return the set of content words inside ±window_size of any target token.

    ``words`` is the lowercased, phrase-joined token list. Matching is
    whole-token, so "cosim" matches "cosim" but not "cosimien".
    ``exclude`` ⊇ targets — it additionally carries the org's own
    acronym / self-referential forms that are NOT matching targets (e.g.
    'cni' rides next to "Conseil National Islamique (CNI)" in almost
    every hit and would otherwise top its own context vocabulary).
    """
    found: Set[str] = set()
    for i, word in enumerate(words):
        if word not in targets:
            continue
        start = max(0, i - window_size)
        end = min(len(words), i + window_size + 1)
        for j in range(start, end):
            if j == i:
                continue
            ctx = words[j]
            if (len(ctx) > 2
                    and ctx.isalpha()
                    and ctx not in stopwords
                    and ctx not in exclude):
                found.add(ctx)
    return found


def build_matrix_for_org(
    article_term_sets: List[Set[str]],
    top_n_terms: int,
    min_cooccurrence: int,
) -> Dict[str, Any]:
    """Pass 2 of the kernel: restrict to the top-N context words by
    document frequency, then count per-article pairs."""
    doc_freq: Dict[str, int] = defaultdict(int)
    for terms in article_term_sets:
        for t in terms:
            doc_freq[t] += 1

    top_terms = sorted(doc_freq.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n_terms]
    term_list = [t for t, _ in top_terms]
    term_idx = {t: i for i, t in enumerate(term_list)}
    n = len(term_list)

    matrix = [[0] * n for _ in range(n)]
    for terms in article_term_sets:
        hit = sorted(term_idx[t] for t in terms if t in term_idx)
        for ai in range(len(hit)):
            for bi in range(ai + 1, len(hit)):
                a, b = hit[ai], hit[bi]
                matrix[a][b] += 1
                matrix[b][a] += 1

    # Zero out weak pairs so the heatmap doesn't drown in noise —
    # same flag semantics as the TF-IDF entity-network generators.
    max_val = 0
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            if matrix[i][j] < min_cooccurrence:
                matrix[i][j] = 0
            elif matrix[i][j] > max_val:
                max_val = matrix[i][j]

    return {
        "terms": term_list,
        "matrix": matrix,
        "max_cooccurrence": max_val,
        "total_articles": sum(1 for t in article_term_sets if t),
        "term_counts": {t: doc_freq[t] for t in term_list},
        "vocabulary_size": len(doc_freq),
    }


def generate(
    repo_id: str,
    targets_file: Path,
    output_dir: Path,
    window_size: int,
    top_n_terms: int,
    min_cooccurrence: int,
    minify: bool,
) -> None:
    logger = logging.getLogger(__name__)
    orgs = load_targets(targets_file)
    logger.info(f"Loaded {len(orgs)} organisations from {targets_file.name}")

    df = load_dataset_safe("articles", repo_id=repo_id)
    if df is None:
        raise RuntimeError("Failed to load 'articles' subset")
    text_col = "OCR" if "OCR" in df.columns else None
    if text_col is None:
        raise RuntimeError("'articles' subset is missing the OCR column")

    # Cross-check the curated o_ids against the index authority records
    # so an Omeka renumbering (or a typo in the sidecar) is caught at
    # build time instead of shipping dead links.
    index_df = load_dataset_safe("index", repo_id=repo_id)
    index_titles: Dict[int, str] = {}
    if index_df is not None:
        org_rows = index_df[index_df["Type"] == "Organisations"]
        index_titles = {
            int(r["o:id"]): str(r["Titre"]).strip()
            for _, r in org_rows.iterrows()
        }
    for org in orgs:
        o_id = org.get("o_id")
        if o_id and index_titles and int(o_id) not in index_titles:
            logger.warning(
                f"org '{org['id']}': o_id {o_id} not found among "
                f"index Organisations — link will 404")

    # Per-org: joined-phrase preprocessing spec. The exclusion set adds
    # the org's own acronym and any curated "exclude" tokens on top of
    # the matching targets, so self-referential forms never count as
    # context vocabulary.
    org_specs = []
    for org in orgs:
        single = {t.lower() for t in org["targets"] if " " not in t}
        multi = [t.lower() for t in org["targets"] if " " in t]
        joined = single | {p.replace(" ", "_") for p in multi}
        exclude = set(joined)
        if org.get("acronym"):
            exclude.add(str(org["acronym"]).lower())
        for extra in org.get("exclude", []):
            exclude.add(str(extra).lower())
        org_specs.append({
            "org": org,
            "multi": multi,
            "targets": joined,
            "exclude": exclude,
            "term_sets": [],   # per matching article: window-context set
            "years": [],
        })

    logger.info(f"Scanning {len(df)} articles (window ±{window_size})…")
    for row_idx in range(len(df)):
        raw = df[text_col].iat[row_idx]
        if not isinstance(raw, str) or not raw:
            continue
        text_lc = raw.lower()
        year = extract_year(df["pub_date"].iat[row_idx]) if "pub_date" in df.columns else None

        for spec in org_specs:
            candidate = text_lc
            # Cheap containment pre-check before the phrase joins + split.
            if not any(t.replace("_", " ") in candidate for t in spec["targets"]):
                continue
            for phrase in spec["multi"]:
                candidate = candidate.replace(phrase, phrase.replace(" ", "_"))
            words = _SPLIT_RE.split(candidate)
            found = scan_article_windows(
                words, spec["targets"], STOPWORDS, window_size, spec["exclude"])
            if found:
                spec["term_sets"].append(found)
                if year is not None:
                    spec["years"].append(year)

    out_orgs: List[Dict[str, Any]] = []
    matrices: Dict[str, Any] = {}
    for spec in org_specs:
        org = spec["org"]
        built = build_matrix_for_org(spec["term_sets"], top_n_terms, min_cooccurrence)
        vocabulary_size = built.pop("vocabulary_size")
        matrices[org["id"]] = built
        years = spec["years"]
        out_orgs.append({
            "id": org["id"],
            "name": org["name"],
            "acronym": org.get("acronym"),
            "country": org.get("country"),
            "o_id": org.get("o_id"),
            "total_articles": built["total_articles"],
            "vocabulary_size": vocabulary_size,
            "year_range": [min(years), max(years)] if years else None,
        })
        logger.info(
            f"  {org['id']}: {built['total_articles']} articles, "
            f"{vocabulary_size} context words, "
            f"max pair {built['max_cooccurrence']}")

    bundle = {
        "generated_at": generate_timestamp(),
        "window_size": window_size,
        "top_n_terms": top_n_terms,
        "min_cooccurrence": min_cooccurrence,
        "orgs": out_orgs,
        "matrices": matrices,
    }
    save_json(bundle, output_dir / "org-cooccurrence.json", minify=minify)
    logger.info("Org co-occurrence data generation complete")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate the Islamic organisations co-occurrence matrix bundle."
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID (default: %(default)s)",
    )
    parser.add_argument(
        "--targets",
        default=str(DEFAULT_TARGETS_FILE),
        help="Curated org/alias sidecar (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write org-cooccurrence.json (default: asset/data).",
    )
    parser.add_argument(
        "--window-size",
        type=int,
        default=50,
        help="Half-width of the token window around each target hit (default: %(default)s).",
    )
    parser.add_argument(
        "--top-n-terms",
        type=int,
        default=30,
        help="Context-word count per matrix — keeps the heatmap readable (default: %(default)s).",
    )
    parser.add_argument(
        "--min-cooccurrence",
        type=int,
        default=2,
        help="Zero out matrix cells below this pair count (default: %(default)s).",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    generate(
        repo_id=args.repo,
        targets_file=Path(args.targets),
        output_dir=Path(args.output_dir),
        window_size=args.window_size,
        top_n_terms=args.top_n_terms,
        min_cooccurrence=args.min_cooccurrence,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
