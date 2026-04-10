#!/usr/bin/env python3
"""
generate_wordcloud.py
=====================

Generate ``asset/data/collection-wordcloud.json`` — a single sidecar file
with French word frequencies across all articles, faceted three ways:
global, by country, and by year.

Based on ``iwac-dashboard/scripts/generate_wordcloud.py``, but emits one
unified JSON file instead of four separate ones. Tokenization, stopwords,
and min-frequency filtering are applied server-side so the browser never
has to touch raw OCR text.

Usage
-----
    python3 scripts/generate_wordcloud.py
    python3 scripts/generate_wordcloud.py --min-frequency 10 --max-words 200
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

# Basic French stopwords — keep the list compact but cover the biggest
# high-frequency items. Extend here rather than pulling NLTK to avoid a
# runtime dependency.
FR_STOPWORDS = set("""
a à ai ainsi ais ait alors après as au aucun aucune aussi autant autre autres
aux avait avant avec avoir ayant c ça car ce ceci cela celle celles celui
cent cependant certain certaine certaines certains ces cet cette ceux chacun
chaque chez ci comme comment d dans de depuis des du deux dès donc dont doux
du durant e elle elles en encore entre es est et étant été être eu eux
fait faire fois font h hors i il ils j je l la là laquelle le lequel les
lesquelles lesquels leur leurs lui m ma mais me même mes mien mienne miennes
miens moi moins mon n ne ni nos notre nous nouveau nouveaux nouvelle nouvelles
o on ont ou où oui par parce pas peu peut peuvent plus plusieurs plutôt pour
pourquoi puis qu quand que quel quelle quelles quels qui quoi s sa sans
se sera serait seront ses si sien sienne siennes siens soi soient sois soit
sommes son sont sous suis sur t ta tandis tant te tel telle telles tels tes
toi ton tous tout toute toutes très trois tu un une vais vas vers voici voilà
vos votre vous y
comme cette dans plus mais tout pour être avoir faire dire voir savoir pouvoir vouloir devoir
""".split())

# Additional IWAC-specific noise words that survived the generic list
CUSTOM_STOPWORDS = set("""
article journal page pages numero numéro nombre date lieu monsieur madame
selon ainsi cependant effet toutefois outre certes ailleurs notamment
""".split())

STOPWORDS = FR_STOPWORDS | CUSTOM_STOPWORDS

TOKEN_RE = re.compile(r"[a-zàâäéèêëïîôöùûüç]+", re.IGNORECASE)


def tokenize(text: str) -> List[str]:
    """Lowercase, strip punctuation, split on whitespace, drop stopwords
    and short tokens. Accepts non-string input (returns empty list)."""
    if not isinstance(text, str) or not text:
        return []
    return [
        tok for tok in TOKEN_RE.findall(text.lower())
        if len(tok) >= 4 and tok not in STOPWORDS
    ]


def build_wordcloud(
    repo_id: str,
    min_frequency: int,
    max_words_per_facet: int,
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading articles subset from %s", repo_id)
    df = load_dataset_safe("articles", repo_id=repo_id)
    if df is None or df.empty:
        logger.warning("No articles loaded; returning empty wordcloud")
        return _empty_result(year_min, year_max)

    text_col: Optional[str] = None
    for candidate in ("OCR", "ocr_text", "OCR_text", "text", "content"):
        if candidate in df.columns:
            text_col = candidate
            break
    if text_col is None:
        logger.warning("No OCR text column found; returning empty wordcloud")
        return _empty_result(year_min, year_max)

    # Optional filter to French only if the language column exists
    if "language" in df.columns:
        lang_series = df["language"].astype(str).str.lower()
        french_mask = lang_series.str.contains("fr", na=False)
        df = df[french_mask]
        logger.info("Filtered to %d French articles", len(df))

    global_counter: Counter = Counter()
    by_country: Dict[str, Counter] = defaultdict(Counter)
    by_year: Dict[str, Counter] = defaultdict(Counter)

    total_articles = 0
    country_article_totals: Counter = Counter()
    year_article_totals: Counter = Counter()

    for idx in range(len(df)):
        text = df[text_col].iat[idx]
        tokens = tokenize(text)
        if not tokens:
            continue
        total_articles += 1
        global_counter.update(tokens)

        # country may be pipe-separated — split so each country gets its own
        # bucket and composite "Benin|Burkina Faso" keys don't leak out.
        countries: List[str] = []
        if "country" in df.columns:
            raw = df["country"].iat[idx]
            for c in parse_pipe_separated(raw):
                c = c.strip()
                if c and c.lower() != "unknown":
                    countries.append(c)
        for country in countries:
            by_country[country].update(tokens)
            country_article_totals[country] += 1

        year = None
        if "pub_date" in df.columns:
            year = extract_year(df["pub_date"].iat[idx], min_year=year_min, max_year=year_max)
        if year is not None:
            year_key = str(year)
            by_year[year_key].update(tokens)
            year_article_totals[year_key] += 1

    def flatten(counter: Counter, articles_in_facet: int) -> Dict[str, Any]:
        filtered = [(w, int(c)) for w, c in counter.most_common() if c >= min_frequency]
        return {
            "data": filtered[:max_words_per_facet],
            "total_articles": int(articles_in_facet),
            "unique_words": len(filtered),
        }

    return {
        "global": flatten(global_counter, total_articles),
        "by_country": {
            country: flatten(counter, country_article_totals[country])
            for country, counter in sorted(by_country.items())
        },
        "by_year": {
            year: flatten(counter, year_article_totals[year])
            for year, counter in sorted(by_year.items())
        },
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "language_filter": "French",
            "min_word_length": 4,
            "min_frequency": min_frequency,
            "max_words_per_facet": max_words_per_facet,
            "stopwords_applied": "fr-custom",
            "countries": sorted(by_country.keys()),
            "years": sorted(by_year.keys()),
            "total_articles": total_articles,
        },
    }


def _empty_result(year_min: int, year_max: int) -> Dict[str, Any]:
    return {
        "global": {"data": [], "total_articles": 0, "unique_words": 0},
        "by_country": {},
        "by_year": {},
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "language_filter": "French",
            "countries": [],
            "years": [],
            "total_articles": 0,
        },
    }


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument("--output", default="asset/data/collection-wordcloud.json")
    parser.add_argument("--min-frequency", type=int, default=5)
    parser.add_argument("--max-words", type=int, default=150)
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    args = parser.parse_args()

    result = build_wordcloud(
        repo_id=args.repo,
        min_frequency=args.min_frequency,
        max_words_per_facet=args.max_words,
        year_min=args.year_min,
        year_max=args.year_max,
    )
    save_json(result, Path(args.output), minify=True)
    logging.getLogger(__name__).info("Wrote %s", args.output)


if __name__ == "__main__":
    main()
