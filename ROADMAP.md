# IWAC Visualizations — Roadmap

Living roadmap for the IwacVisualizations Omeka S module. See
[`README.md`](README.md) for the current architecture and
[`DATA_NOTES.md`](DATA_NOTES.md) for the full Hugging Face dataset
schema.

## Data source

- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) — 6 subsets, ~19,420 rows.
- `o:id` in the dataset maps 1:1 to Omeka item IDs on <https://islam.zmo.de> → per-item JSON can be keyed directly by `o:id` and consumed by resource-page blocks via the existing `data-item-id` attribute.
- Updated roughly monthly; precompute is a manual developer step.

## Precompute reference

**`/home/fmadore/projects/iwac-dashboard/scripts/`** — sibling SvelteKit
dashboard with ~3,200 lines of working Python reading the same HF
dataset. Reuse its patterns before writing new generators. `iwac_utils.py`
has been ported verbatim into `scripts/`. See `scripts/README.md`.

## Done

- **Scaffold** (2026-04) — module structure forked from
  ResourceVisualizations; namespace renamed to `IwacVisualizations`;
  fresh git history; 200+ MB of stale precomputed data cleared.
- **Theme + i18n infrastructure** (2026-04) — `iwac-i18n.js`,
  `iwac-theme.js`, rewritten `dashboard-core.js` under the `IWACVis`
  namespace. ECharts themes are built from the IWAC theme's live CSS
  custom properties (`--primary`, `--ink`, `--surface`, ...), so chart
  colors always track the site's brand config and the light/dark
  toggle. `MutationObserver` on `body[data-theme]` disposes and
  re-renders every tracked chart when the user toggles.
- **Gettext catalog** (2026-04) — `language/template.pot`,
  `language/fr.po`; loading/UI strings covered for the first block.
- **HF dataset audit** (2026-04) — full schema for all 6 subsets
  documented in `DATA_NOTES.md`.
- **Collection Overview page block** (2026-04) — first end-to-end
  visualization:
  - `scripts/generate_collection_overview.py` pulls summary stats,
    timeline by year × country, country / language distributions, and
    top-N entities per type from the `index` subset
  - `asset/js/charts/collection-overview.js` renders 4 ECharts panels
    (timeline, countries, languages, tabbed top-entities) with
    click-through to Omeka items on the entity bars
  - Summary cards use HTML/CSS only (no chart framework) for the
    big-number row
  - Responsive grid: single column on mobile, two columns above 800 px,
    full-width panels for the timeline and entities

## Next up

- [ ] **Audit Omeka resource templates** on islam.zmo.de → HF subset
      mapping. Needed before implementing any resource-page block
      (knowledge graph, per-item dashboards). User will point at the
      templates directly.
- [ ] **Decide per-item JSON hosting**: commit ~5k entity dashboards to
      git, or generate into an Omeka volume at deploy time. Check how
      iwac-dashboard handles its `static/data/` volume.
- [ ] **Per-entity dashboard** (resource-page block attached to the
      `index`-backed item templates): timeline of mentions, top
      newspapers, co-occurring entities, geographic footprint.
      Generator will be `scripts/generate_entity_dashboards.py`.
- [ ] **Per-article page** (resource-page block attached to the
      "article de presse" template): 3-model AI sentiment comparison
      panel (centrality, polarity, subjectivity), LDA topic badge,
      readability + word count, entities mentioned (linked back to the
      authority pages).

## Later

- [ ] Semantic-neighbor "related articles" using `embedding_OCR` cosine
      similarity (precomputed kNN offline)
- [ ] Knowledge graph per entity — model on
      `iwac-dashboard/scripts/generate_knowledge_graph.py`
- [ ] World map page block — polygon choropleth of the 6 countries +
      marker clusters from `index` `Lieux` entries with `Coordonnées`
- [ ] Topic explorer page block — LDA 30-topic overview with drill-down
- [ ] Item-set dashboard — aggregate per Omeka item set

## Open questions

1. **Omeka template → HF subset mapping**: which templates map to
   `articles` vs `publications` vs `documents` vs `audiovisual` vs
   `index:{Personnes|Organisations|Lieux|...}`? Waiting on user input.
2. **audiovisual (45) / documents (26)** are tiny — skip per-item
   dashboards entirely and fold them into collection-level stats only?
3. **Hosting strategy** for 5k+ per-item JSONs — git vs deploy-time
   volume vs sharded index file.

## Deferred / orphaned

The following inherited assets from ResourceVisualizations are on disk
but **not loaded** anywhere. They exist only as reference patterns
while the rewrite is in progress and will be deleted once the
replacements land:

- `asset/js/dashboard-*.js` (20+ chart files under the old `RV`
  namespace)
- `asset/js/knowledge-graph.js`
- `asset/js/dashboard-compare.js`, `dashboard-compare-unify.js`
- `asset/js/dashboard-collab-network.js`

Their PHTML stubs (`knowledge-graph.phtml`, `linked-items-dashboard.phtml`,
`item-set-dashboard.phtml`, `compare-projects.phtml`) render a loading
spinner only — no chart code is wired yet.
