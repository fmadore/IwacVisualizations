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
    asset/data/laicite-sentiment.json     # per-model AI framing vs a baseline
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
2. **It scans five subsets, not one.** ``articles`` (press coverage),
   ``publications`` (Islamic periodicals), ``documents`` (archival material)
   ``audiovisual`` (YouTube videos only), and ``references`` (scholarship)
   are different evidentiary objects, so
   every record carries a ``subset`` discriminator and **no bundle sums
   across subsets without labelling it**. The first four are all primary
   sources — see ``SOURCE_TYPES``, which is about evidentiary status, not
   genre; ``references`` contains scholarship. Its publication dates must
   be interpreted separately from dates of primary-source coverage; the
   primary-source aggregate excludes it, and its own chronology is opt-in.
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
live in ``scripts/laicite/laicite_lexicon.json`` so it stays tunable without a code
change.

Privacy — the rights gate
--------------------------
This script reads the **private** full mirror where ``OCR`` is populated for
every row regardless of source visibility, and the bundles are served
publicly from ``files/iwac-visualizations/``. So a KWIC snippet cut from
``OCR`` is emitted **only** when the row's ``OCR_is_public`` flag is true —
the same per-value gate ``publish_public.py`` applies, and the identical
constraint ``generate_on_this_day.py`` documents. Never relax it.

The gate is applied **per source field, not per item**: titles are public,
while original full text and transcripts follow ``OCR_is_public``. Only
``title`` and ``OCR`` are searched. AI descriptions, abstracts, video
descriptions and tables of contents remain contextual metadata and never
supply vocabulary matches or concordance passages. Rates use alphabetic
word tokens in those same searched fields, including titles.

YouTube videos are selected from ``audiovisual.source_type == "youtube"``.
A catalogue tag can select a video without a transcript; its missing text
is not replaced by the description. Metadata reports transcript coverage
for the YouTube corpus and the selected videos. Publication/upload dates
may differ from the date of the recorded event.

Categories are independent: overlapping phrases can belong to more than
one category, but matches are non-overlapping within each category. Bare
"succession" is excluded from law/family vocabulary; explicit legal
phrases are retained. Typographic apostrophes are normalized for matching
without changing the original excerpt offsets.

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
import sys
from pathlib import Path

# The generator is a package now (``scripts/laicite/``), one module per
# bundle, mirroring ``asset/js/charts/laicite/``. This file is the CLI it
# has always been — every invocation, CI step and doc reference that names
# ``scripts/generate_laicite.py`` keeps working.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from iwac_utils import add_standard_args, parse_standard_args, save_json  # noqa: E402

from laicite import LaiciteGenerator  # noqa: E402


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
    parser.add_argument("--validation-output", type=Path,
                        help="Write a metadata-only stratified human-coding worklist to this JSON path.")
    args = parse_standard_args(parser)
    generator = LaiciteGenerator(
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
    )
    generator.run()
    if args.validation_output:
        save_json(generator.validation_sample(), args.validation_output)


if __name__ == "__main__":
    main()
