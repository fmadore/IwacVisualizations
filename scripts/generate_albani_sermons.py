#!/usr/bin/env python3
"""
generate_albani_sermons.py
==========================

Generate the bundles behind the IwacVisualizations "Albani Zaria sermons"
page block (GitHub issue #31): an exhibition of the Hausa / Arabic
transcripts of the sermons and lessons of Shaykh Muhammad Auwal Albani Zaria
(Daarul Hadeethis Salafiyyah, Zaria, c. 1999–2014), centred on youth,
democracy and politics.

    asset/data/albani-sermons/metadata.json      the corpus and its status
    asset/data/albani-sermons/vocabulary.json    Hausa / Arabic frequency lists
    asset/data/albani-sermons/lexicon.json       seed-lexicon counts
    asset/data/albani-sermons/collocates.json    words that travel with each category
    asset/data/albani-sermons/network.json       terms and collocates as a graph
    asset/data/albani-sermons/overlap.json       where youth meets politics
    asset/data/albani-sermons/keyness.json       recording / period / mode keyness
    asset/data/albani-sermons/concordance-youth.json     KWIC lines — RIGHTS-GATED
    asset/data/albani-sermons/concordance-politics.json  (one file per theme)

The generator is a package, ``scripts/albani/``: the strict transcript
parser, the Hausa folding and tokenizer, the layer classifier, the lexicon
matcher, the corpus model and the bundle builders. Read the module
docstrings for the decisions; the short version:

* One preacher's corpus — ``deposited`` audiovisual items whose pipe-split
  ``creator`` includes Muhammad Auwal Albani Zaria — not "Hausa Muslim
  opinion".
* The transcript markup is parsed, never counted, and the parser is strict:
  the two recordings still in the older format (15850 *Demokuradiyyah*,
  15878 *Shari'a*) are listed and kept out of every statistic until they are
  re-transcribed; any other unreadable transcript stops the run.
* The lexicons are **seed candidates** awaiting a Hausa-speaking
  specialist. ``--review-sheet`` writes the CSV they validate.
* Aggregates are published for every transcript; KWIC lines only for those
  whose ``OCR_is_public`` is true, and no aggregate string is longer than
  three words. The generator checks both on its own output.

Usage
-----
    python scripts/generate_albani_sermons.py
    python scripts/generate_albani_sermons.py --review-sheet .test-tmp/albani-review.csv
    python scripts/generate_albani_sermons.py --transcripts-dir DIR --offline

``--transcripts-dir`` overlays ``<o:id>.txt`` files on the mirror's ``OCR``
column, for running ahead of the next dataset push (the mirror lags Omeka).
Overlaid text is treated as PRIVATE unless ``--transcripts-public`` says the
files were fetched from the public API.

Environment
-----------
    HF_TOKEN    Hugging Face access token — required, the default dataset is
                the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from iwac_utils import add_standard_args, load_dataset_safe, parse_standard_args  # noqa: E402

from albani import AlbaniSermonsGenerator  # noqa: E402
from albani.corpus import COLUMNS  # noqa: E402


def overlay_transcripts(df, directory: Path, public: bool):
    """Replace ``OCR`` with ``<o:id>.txt`` from ``directory`` where present."""
    df = df.copy()
    for path in sorted(Path(directory).glob("*.txt")):
        mask = df["o:id"].astype(str) == path.stem
        if not mask.any():
            continue
        df.loc[mask, "OCR"] = path.read_text(encoding="utf-8")
        df.loc[mask, "OCR_is_public"] = bool(public)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate the Albani Zaria sermons bundles for the "
                    "IwacVisualizations block.")
    parser.add_argument("--output-dir", default="asset/data",
                        help="Data directory; bundles go to <dir>/albani-sermons/ "
                             "(default: %(default)s).")
    parser.add_argument("--window", type=int, default=5,
                        help="Collocation half-window, in tokens (default: %(default)s).")
    parser.add_argument("--overlap-window", type=int, default=10,
                        help="Largest gap, in tokens, at which a youth and a politics "
                             "term count as meeting (default: %(default)s).")
    parser.add_argument("--min-collocate-count", type=int, default=5,
                        help="Minimum in-window occurrences for a collocate "
                             "(default: %(default)s).")
    parser.add_argument("--min-segments", type=int, default=3,
                        help="A collocate or frequent word must occur in this many "
                             "20-minute segments (default: %(default)s).")
    parser.add_argument("--min-recordings", type=int, default=2,
                        help="…and in this many recordings (default: %(default)s).")
    parser.add_argument("--kwic-per-entry", type=int, default=100,
                        help="Concordance lines kept per lexicon entry, spread across "
                             "recordings (default: %(default)s).")
    parser.add_argument("--period-split", default="2009-07-01",
                        help="Date splitting the period keyness (default: %(default)s).")
    parser.add_argument("--review-sheet", type=Path,
                        help="Also write the candidate review CSV to this path. It "
                             "quotes public transcripts only; keep it out of git.")
    parser.add_argument("--transcripts-dir", type=Path,
                        help="Overlay <o:id>.txt transcripts on the mirror's OCR.")
    parser.add_argument("--transcripts-public", action="store_true",
                        help="Treat overlaid transcripts as public (they came from "
                             "the public API).")
    parser.add_argument("--offline", action="store_true",
                        help="Skip the IIIF manifests; windows link to the item page.")
    add_standard_args(parser, minify_default=False)
    args = parse_standard_args(parser)

    frame = None
    if args.transcripts_dir:
        frame = load_dataset_safe("audiovisual", repo_id=args.repo,
                                  token=os.getenv("HF_TOKEN"), columns=COLUMNS,
                                  required=True)
        frame = overlay_transcripts(frame, args.transcripts_dir, args.transcripts_public)

    generator = AlbaniSermonsGenerator(
        output_dir=Path(args.output_dir),
        repo_id=args.repo,
        minify=args.minify,
        window=args.window,
        overlap_window=args.overlap_window,
        min_collocate_count=args.min_collocate_count,
        min_segments=args.min_segments,
        min_recordings=args.min_recordings,
        kwic_per_entry=args.kwic_per_entry,
        period_split=args.period_split,
        fetch_manifests=not args.offline,
        frame=frame,
    )
    generator.run(review_sheet=args.review_sheet)


if __name__ == "__main__":
    main()
