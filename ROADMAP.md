# IWAC Visualizations — Roadmap

Initial scaffold lifted from [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations). This roadmap will be rewritten once IWAC-specific requirements are clearer.

## Data source

- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) — 6 subsets, ~19,420 rows. Full breakdown in [`DATA_NOTES.md`](DATA_NOTES.md).
- `o:id` in the dataset maps 1:1 to Omeka item IDs on https://islam.zmo.de → per-item JSON can be keyed directly by `o:id`.
- Updated roughly monthly; precompute is a manual step.

## Precompute reference

**`/home/fmadore/projects/iwac-dashboard/scripts/`** — ~3,200 lines of working Python that reads the same HF dataset and generates aggregated JSON. Reuse its patterns, especially `iwac_utils.py` (598 lines of shared helpers). See [`DATA_NOTES.md`](DATA_NOTES.md) for a file-by-file map of what's reusable.

## Immediate next steps

- [x] Survey IWAC's data on Hugging Face — see `DATA_NOTES.md`
- [ ] Audit which Omeka resource templates on islam.zmo.de correspond to which HF subset (needed to attach the right block to the right page)
- [ ] Bootstrap the precompute pipeline: copy `iwac_utils.py` into `scripts/` and write the first generator (`generate_collection_overview.py`)
- [ ] Build the first visualization end-to-end as a proof-of-concept: collection overview timeline + top entities from `index`
- [ ] Decide hosting strategy for per-item JSON (git-commit vs. deploy-time volume)

## Inherited visualizations (from ResourceVisualizations)

Full chart library is present under `asset/js/dashboard-charts-*.js`. These will be pruned or reworked:

- Timeline, stacked timeline, Gantt, beeswarm
- Pie, bar, wordcloud
- Heatmap, chord, sankey, sunburst, treemap, stacked area
- Map (origins), geo flows (origin → current location)
- Contributor network, collaboration network
