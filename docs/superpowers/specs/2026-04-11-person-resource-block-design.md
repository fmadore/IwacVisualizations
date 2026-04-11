# Person Resource Page Block — Design

Date: 2026-04-11
Status: Draft, pending review
Author: Claude + Frédérick Madore
Related: [Collection Overview expansion](2026-04-10-collection-overview-expansion-design.md)

## 1. Goal

Add a resource-page block that renders a per-person dashboard on any
Omeka item whose resource template is `Personnes` (template ID 5) on
<https://islam.zmo.de>. The block is dynamic (ECharts + MapLibre) and
answers the question: **what does this person's life in the IWAC
collection look like?**

Example target: <https://islam.zmo.de/api/items/1057> (Idriss Koudouss
Koné, ~300 archival references).

## 2. Non-goals

- Visualizations for the four other index entity types
  (`Organisations`, `Lieux`, `Sujets`, `Événements`). The block skeleton
  is intentionally designed to generalize, but only `Personnes` ships
  in v1.
- A "recent items" or "items referencing this person" table. The
  count of mentions is surfaced in the summary row; the full list is
  already reachable through Omeka's default item linking.
- Per-article sentiment or LDA panels (separate block, later pass).
- Date fields on the header card (no `Naissance`, `foaf:birthday`,
  `foaf:deathDate`). Not needed for v1 per user direction.

## 3. Source material

### 3.1 Omeka item 1057 shape (confirmed via Omeka API)

```
o:id             = 1057
o:resource_template = { o:id: 5 }         ← gate on this
@type            = ["o:Item", "foaf:Person"]
dcterms:title    = "Idriss Koudouss Koné"
foaf:firstName   = "Idriss Koudouss"
foaf:lastName    = "Koné"
foaf:gender      = link to item 12335 ("Homme")
dcterms:description = bilingual (fr + en)
dcterms:alternative = 19 name variants
dcterms:isPartOf    = linked items (Conseil National Islamique, Imam, …)
dcterms:spatial     = linked items (Côte d'Ivoire, …)
dcterms:identifier  = Wikidata URI + internal iwac-index-NNNNNN
@reverse            = ~300 content items referencing this person
                      (as dcterms:subject or dcterms:creator)
```

### 3.2 Hugging Face dataset — IWAC collection

- `index` subset (4,697 rows) — authority file, pre-aggregated. Rows
  where `Type == "Personnes"` are the universe for this block (~1,400
  persons).
- `articles` (12,287) / `publications` (1,501) / `references` (864) —
  content items that mention persons.
- Join key: the `subject` field on content items is pipe-separated and
  holds strings that match `index.Titre` (or `Titre alternatif` as a
  fallback). `author` on `references` holds pipe-separated creator
  names that are matched the same way.
- The precompute pattern is already solved upstream in
  `/home/fmadore/projects/iwac-dashboard/scripts/generate_entity_spatial.py`
  (normalized name lookup against `index` entities), which this
  generator mirrors.

### 3.3 Reusable primitives already in the module

```
asset/js/charts/shared/
  panels.js          # buildPanel, buildSummaryCards, buildChartsGrid, el, t, escapeHtml, ...
  chart-options.js   # C.timeline, C.horizontalBar, C.pie, C.newspaper, C.entities,
                     #   C.treemap, C.gantt, C.wordcloud, C.growthBar, C.stackedBar
  table.js           # P.buildTable (not used in v1 — recent-items panel dropped)
  pagination.js      # P.buildPagination
  facet-buttons.js   # P.buildFacetButtons
  maplibre.js        # P.createIwacMap, P.createIwacPopup — theme-aware
```

Everything the Person block needs **except `C.network`** already exists.

## 4. Panels (v1)

All panels that consume aggregated data read from one JSON:
`asset/data/person-dashboards/{o_id}.json`. The header card is rendered
server-side from the Omeka representation.

| # | Panel | Source | Builder |
|---|---|---|---|
| 1 | Header card (thumbnail, name, gender badge, bio, Wikidata chip, affiliation chips) | PHTML, Omeka representation | inline PHP/HTML |
| 2 | Summary stats row (5 cards) | `summary.*` | `P.buildSummaryCards` |
| 3 | Global facet bar: `All / As subject / As creator` | client state | `P.buildFacetButtons` |
| 4 | Mentions timeline (year × country, stacked) | `timeline.by_role[role]` | `C.timeline` |
| 5 | Top newspapers (horizontal bar, click → item) | `newspapers.by_role[role]` | `C.newspaper` |
| 6 | Countries breakdown (horizontal bar) | `countries.by_role[role]` | `C.horizontalBar` |
| 7 | Neighbors network (force graph, nodes colored by Type) | `network.by_role[role]` | `C.network` (new) |
| 8 | Locations map (MapLibre bubbles) | `locations.by_role[role]` | `P.createIwacMap` + `P.createIwacPopup` |

Responsive grid is inherited from
`.iwac-vis-overview-grid`: single column < 800 px, two columns above,
`--wide` modifier for the timeline / network / map / gantt-style rows.

## 5. Neighbor selection — TF-IDF distinctiveness

The "associated entities" panel **must not** surface the same handful
of globally-common entities for every person (user requirement: if 85%
of Persons co-occur with an entity, that entity is noise for
this panel).

### 5.1 Scoring

For a given person `P` and a candidate neighbor entity `X`
(any index row regardless of Type):

```
cooc(X, P) = number of content items referencing both X and P
df(X)      = number of Persons whose item set touches X at all
N_persons  = total number of Personnes in the index

score(X, P) = cooc(X, P) * log(N_persons / df(X))
```

- `cooc(X, P) >= min_cooccurrence` where `min_cooccurrence = 2`.
  Singletons are dropped — TF-IDF alone would rank them noisily.
- Neighbors are sorted by `score` descending.
- **Top cap: 50 neighbors** per person per role slice. Picked to match
  the existing entities panel cap in Collection Overview and to keep
  the force-graph layout readable; 60+ starts to clutter.

### 5.2 Where it runs

In the Python generator, once per person. Resulting rank is baked into
the JSON (`network.by_role[role].nodes` already sorted, edges carry
their raw `cooc` count and final `score`). The browser does no scoring.

### 5.3 Edge weighting

Edge width in the force graph uses the TF-IDF `score`, not raw
co-occurrence, so the visual weight also reflects distinctiveness.

## 6. Global facet — creator vs subject

A single button group (`All / As subject / As creator`) at the top of
the grid. State is held in the orchestrator and pushed to each panel
via a subscribe pattern:

```js
var facet = { role: 'all' };
var subscribers = [];
function setRole(role) {
    facet.role = role;
    subscribers.forEach(function (fn) { fn(role); });
}
```

Each panel module registers one subscriber. When the role changes, the
panel reads its own `by_role[role]` slice from the precomputed data
and calls `setOption(..., true)` on its ECharts instance (or
`setData()` on its MapLibre source, or rebuilds its DOM for HTML
panels). No refetch, no recompute — everything is prebaked.

The **summary stats row** follows the same rule (the numbers update
when the role changes).

### 6.1 Role assignment in the Python generator

For each content item that references the person:

- In `articles` / `publications`: the person is pulled from the
  `subject` field → role `subject`. These subsets do not consistently
  populate `author`/`dcterms:creator` for persons, so "creator" from
  those subsets is almost always empty — that is fine.
- In `references`: the person is pulled from `author` →
  role `creator`. Pulled from `subject` → role `subject`.
- `role = all` is just the union of the two, not a separate data pass.

## 7. Data shape — `person-dashboards/{o_id}.json`

```json
{
    "version": 1,
    "generated_at": "2026-04-11T00:00:00Z",
    "person": {
        "o_id": 1057,
        "title": "Idriss Koudouss Koné",
        "prenom": "Idriss Koudouss",
        "nom": "Koné",
        "genre": "Homme",
        "countries": ["Côte d'Ivoire"],
        "first_occurrence": "1994-03-15",
        "last_occurrence": "2016-11-02"
    },
    "summary": {
        "by_role": {
            "all":     { "total_mentions": 298, "year_min": 1994, "year_max": 2016,
                         "newspapers_count": 12, "countries_count": 3, "neighbors_count": 47 },
            "subject": { "total_mentions": 296, "year_min": 1994, "year_max": 2016,
                         "newspapers_count": 12, "countries_count": 3, "neighbors_count": 47 },
            "creator": { "total_mentions": 2,   "year_min": 2001, "year_max": 2008,
                         "newspapers_count": 2,  "countries_count": 1, "neighbors_count": 3 }
        }
    },
    "timeline": {
        "by_role": {
            "all":     { "years": [1994, ..., 2016], "countries": ["CIV", "BFA", ...],
                         "series": { "CIV": [3, 5, ...], ... } },
            "subject": { ... },
            "creator": { ... }
        }
    },
    "newspapers": {
        "by_role": {
            "all": [
                { "name": "Fraternité Matin", "o_id": 321, "total": 142,
                  "articles": 140, "publications": 2, "country": "CIV",
                  "year_min": 1994, "year_max": 2016 },
                ...
            ],
            ...
        }
    },
    "countries": {
        "by_role": {
            "all":     [ { "name": "CIV", "count": 280 }, ... ],
            ...
        }
    },
    "network": {
        "by_role": {
            "all": {
                "nodes": [
                    { "o_id": 1057, "title": "Idriss Koudouss Koné",
                      "type": "center", "score": null, "cooc": null },
                    { "o_id": 123, "title": "Conseil National Islamique",
                      "type": "Organisations", "score": 42.7, "cooc": 85 },
                    ...
                ],
                "edges": [
                    { "source": 1057, "target": 123, "weight": 42.7, "cooc": 85 },
                    ...
                ]
            },
            "subject": { ... },
            "creator": { ... }
        }
    },
    "locations": {
        "by_role": {
            "all": [
                { "name": "Abidjan", "o_id": 456, "lat": 5.359, "lng": -4.008,
                  "country": "CIV", "count": 120 },
                ...
            ],
            ...
        }
    }
}
```

### 7.1 Notes

- Every panel's `by_role` map always carries all three keys (`all`,
  `subject`, `creator`). Empty role slices use the appropriate empty
  shape (`{"years": [], "countries": [], "series": {}}` for timeline,
  `[]` for arrays). The orchestrator's panel modules handle empty
  slices by rendering the existing `iwac-vis-empty` placeholder.
- `network.nodes` is already sorted by `score` descending and capped
  at 50 neighbors. The **person themselves is `nodes[0]`** with
  `type: 'center'` and `score: null` so edge `source` IDs resolve
  cleanly in ECharts and the browser can style the center node
  differently (larger radius, pinned position) without a separate
  lookup. `network.edges` only references node IDs that appear in
  `nodes`.
- `countries.by_role[*]` uses ISO3 codes as names to match the
  existing country normalization in `iwac_utils.py`. The browser
  translates them for display.
- JSON files are expected to be 10–60 KB each. ~1,400 files total,
  roughly 50 MB uncompressed — on par with the existing collection
  map sidecar. They will be committed to git alongside the existing
  `collection-overview.json` et al.

## 8. Implementation layout

### 8.1 New files

```
src/Site/ResourcePageBlockLayout/
    PersonDashboard.php            # new block layout, gated on template id 5

view/common/resource-page-block-layout/
    person-dashboard.phtml         # renders header card (server-side) + async container

asset/js/charts/
    person-dashboard.js            # orchestrator (fetch → buildLayout → wire panels)
    person-dashboard/
        stats.js                   # summary stats row (HTML, no chart)
        facet.js                   # global facet bar + subscription plumbing
        timeline.js                # wraps C.timeline
        newspapers.js              # wraps C.newspaper
        countries.js               # wraps C.horizontalBar
        network.js                 # wraps C.network (new)
        map.js                     # wraps createIwacMap + createIwacPopup

scripts/
    generate_person_dashboards.py  # new generator — fan-out one JSON per person
```

### 8.2 Modified files

```
config/module.config.php           # register 'personDashboard' block layout
asset/js/charts/shared/chart-options.js   # add C.network
asset/js/iwac-i18n.js              # add person.* keys (EN + FR)
language/template.pot              # new translate() strings from PersonDashboard.php
language/fr.po                     # French translations
asset/css/iwac-visualizations.css  # .iwac-vis-person-header + network node colors
README.md                          # document the new block
ROADMAP.md                         # mark "per-entity page block" partially done
scripts/README.md                  # document the new generator
```

### 8.3 `Module.php`

No changes. The item controller already attaches the i18n / theme /
core / shared primitives bundle via `addAssets()`. The Person block's
PHTML enqueues the chart-specific scripts (`person-dashboard.js` and
its panel modules) the same way `collection-overview.phtml` does today.

### 8.4 `PersonDashboard.php` gating

```php
public function getCompatibleResourceNames(): array
{
    return ['items'];
}

public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
{
    $template = $resource->resourceTemplate();
    if (!$template || $template->id() !== 5) {
        return '';
    }
    return $view->partial('common/resource-page-block-layout/person-dashboard', [
        'resource' => $resource,
    ]);
}
```

The template ID is not hardcoded as a magic number — it lives in a
`const PERSONS_TEMPLATE_ID = 5;` on the class so the read site is
self-documenting and the value is easy to change if the template is
rebuilt on the live site.

## 9. New shared builder — `C.network`

Added to `asset/js/charts/shared/chart-options.js`, reusable by future
blocks (other entity types, knowledge-graph block).

### 9.1 Signature

```js
/**
 * Force-layout entity network.
 *
 * @param {Object} graph
 * @param {Array<{o_id, title, type, score, cooc}>} graph.nodes
 * @param {Array<{source, target, weight, cooc}>}   graph.edges
 * @param {Object} [opts]
 * @param {number} [opts.centerId]      // node o_id to pin at center
 * @param {number} [opts.maxLabelLength=24]
 * @param {Object} [opts.typeColors]    // override per-type color
 * @returns {Object} ECharts option
 */
C.network = function (graph, opts) { ... }
```

### 9.2 Behavior

- ECharts `series.type = 'graph'`, `layout: 'force'`,
  `roam: true`, `draggable: true`.
- Node size proportional to `Math.sqrt(score)` (visual variance without
  outliers dominating).
- Node color by `type` from a per-module palette that falls back to the
  live IWAC theme palette via `IWACVis.getPalette()`:

  ```js
  var TYPE_COLORS = {
      'Personnes':     palette[0],
      'Organisations': palette[1],
      'Lieux':         palette[2],
      'Sujets':        palette[3],
      'Événements':    palette[4]
  };
  ```

- Edge width proportional to `Math.sqrt(weight)` where `weight` is the
  TF-IDF score from the JSON.
- Tooltip on node: title, type, cooc count, score. Tooltip on edge:
  source title, target title, cooc count.
- Click on node: navigate to `siteBase + '/item/' + o_id`, matching
  the existing entities panel pattern.
- Center node (the current person) is pinned with `fixed: true` so the
  layout orbits it; all other nodes relax freely.
- Legend: one entry per Type with the matching color swatch.
- `emphasis.focus = 'adjacency'` — hovering a node dims everything
  except the node and its immediate neighbors. Cheap hover clarity.

### 9.3 Theme / light-dark

Colors come from the live palette, same as every other chart. Because
`dashboard-core.js` disposes + reinits on `body[data-theme]` change,
`C.network` needs no extra plumbing. The node stroke color and label
color are not hardcoded — they read from the ECharts theme registered
by `iwac-theme.js`.

## 10. `scripts/generate_person_dashboards.py`

### 10.1 High-level flow

```
load_dataset('index', 'articles', 'publications', 'references')
build entity_lookup = { normalize_name(Titre or Titre alternatif): index_row }
build person_set    = { o_id: index_row }  where Type == 'Personnes'

for each content item (articles / publications / references):
    link entities mentioned in:
        - subject (pipe-separated)       → role 'subject'
        - author  (pipe-separated) if present → role 'creator'
    resolve each via entity_lookup; keep only hits
    emit (item, role, entity_list) tuples

build per-person aggregate:
    for each person P:
        items_P = content items that mention P in some role
        compute:
            summary.by_role            (counts, year range, etc.)
            timeline.by_role           (year × country)
            newspapers.by_role         (top N sources with year range)
            countries.by_role          (ISO3 breakdown)
            network.by_role            (TF-IDF ranked top 50 neighbors)
            locations.by_role          (join to index Lieux rows for coords)

write asset/data/person-dashboards/{o_id}.json
```

### 10.2 Reused from `iwac_utils.py`

- `normalize_country`, `parse_pipe_separated`, `parse_coordinates`,
  `load_dataset_safe`, `save_json`, `configure_logging`, `DATASET_ID`.
- Name normalization follows `generate_entity_spatial.py` — Unicode
  lowercase, strip combining marks, collapse whitespace, strip stray
  punctuation.

### 10.3 TF-IDF computation

```python
from math import log
from collections import Counter, defaultdict

N_persons = len(person_set)

# df[X] = number of Persons whose item set touches entity X
df = Counter()
for person_o_id, item_ids in persons_items.items():
    touched = set()
    for item_id in item_ids:
        touched.update(entities_per_item[item_id])
    for x in touched:
        df[x] += 1

def score(cooc_xp, x_o_id):
    df_x = max(df.get(x_o_id, 1), 1)
    return cooc_xp * log(N_persons / df_x) if df_x > 0 else 0.0
```

For each person, per role:

1. Count `cooc(X, P)` across the role's item set.
2. Filter `cooc >= 2`.
3. Score each surviving `X`.
4. Sort by score desc, keep top 50.
5. Emit nodes + edges.

### 10.4 Locations panel

Joins mentioned `index.Lieux` entries to coordinates the same way
`iwac-dashboard/scripts/generate_entity_spatial.py` does — `Coordonnées`
column, parsed via `parse_coordinates`. Rows without coordinates are
excluded silently.

### 10.5 Output cardinality

- ~1,400 person JSON files
- ~50 MB total uncompressed (10–60 KB each)
- Runs in a few minutes on a laptop; not intended for CI

### 10.6 Committed to git

Consistent with `collection-overview.json`. If the total grows past
~100 MB the next iteration can switch to a sharded index loader, but
v1 stays simple.

## 11. i18n keys to add

EN + FR, under a new `person` namespace. Keys:

```
'Mentions'                   fr: 'Mentions'
'As subject'                 fr: 'Comme sujet'
'As creator'                 fr: 'Comme créateur'
'All roles'                  fr: 'Tous les rôles'
'Associated entities'        fr: 'Entités associées'
'Locations mentioned'        fr: 'Lieux mentionnés'
'Top newspapers'             fr: 'Journaux les plus fréquents'
'Countries covered'          fr: 'Pays couverts'
'Neighbors'                  fr: 'Voisins'
'Newspapers'                 fr: 'Journaux'
'Total mentions'             fr: 'Mentions totales'
'Distinctiveness score'      fr: 'Indice de spécificité'
'Affiliations'               fr: 'Affiliations'
'Wikidata'                   fr: 'Wikidata'

// entity_type_* — labels for index.Type values, used by C.network legend
'entity_type_Personnes'      fr: 'Personnes'   en: 'Persons'
'entity_type_Organisations'  fr: 'Organisations' en: 'Organizations'
'entity_type_Lieux'          fr: 'Lieux'       en: 'Places'
'entity_type_Sujets'         fr: 'Sujets'      en: 'Subjects'
'entity_type_Événements'     fr: 'Événements'  en: 'Events'
```

`PersonDashboard.php`'s `getLabel()` string uses `@translate` in the
POT file per existing pattern.

## 12. CSS additions

Scoped under `.iwac-vis-person-*` to avoid collisions with other
blocks:

```
.iwac-vis-person-header         # header card container (flex row)
.iwac-vis-person-header__avatar # thumbnail (rounded square)
.iwac-vis-person-header__body   # name + chips + bio column
.iwac-vis-person-header__name   # dcterms:title
.iwac-vis-person-header__gender # gender badge chip
.iwac-vis-person-header__bio    # dcterms:description
.iwac-vis-person-header__meta   # affiliation + wikidata chips row
.iwac-vis-person-header__chip   # pill-shaped chip, link or plain
```

All colors / radius / spacing come from existing IWAC theme tokens
(`--surface-raised`, `--border`, `--primary`, `--radius-md`, `--space-*`).
No hardcoded hex values.

## 13. Edge cases & error handling

| Case | Behavior |
|---|---|
| Non-Person item with block attached | `render()` returns `''`, block disappears silently |
| Person with no content-item matches | JSON exists but every `by_role.*` array is empty; each panel renders the `iwac-vis-empty` placeholder |
| Person with some content but no locations | Locations panel renders empty placeholder; header card still shows `dcterms:spatial` chips if present |
| Person with fewer than 50 distinctive neighbors | Network shows whatever qualifies (min_cooccurrence ≥ 2) |
| JSON file missing on disk (not yet generated) | Block shows `iwac-vis-error` ("Failed to load"), same path as Collection Overview's fetch failure |
| Wikidata URI absent | Chip is hidden |
| Affiliations absent | Chip row is hidden, but the bio column still spans the full width |
| Theme toggle during render | `dashboard-core.js` disposes + re-renders every tracked ECharts + reassigns MapLibre style, same as every other block |
| Person has ONLY author-role items (rare) | Facet bar hides the "As subject" button if that slice is empty — and vice versa. Guarded by counts in `summary.by_role` |

## 14. Testing plan

- **Unit / pipeline**: `scripts/generate_person_dashboards.py` has a
  `--limit N` flag for smoke-testing on 10 persons before a full run.
- **Manual**: drop the new block on the Idriss Koné item (1057),
  verify all 8 panels render, click through the facet bar, click a
  neighbor node, click a newspaper bar, hover markers on the map,
  toggle light/dark theme mid-view.
- **Sanity**: Collection Overview still renders (no regressions to
  shared chart builders).
- **i18n**: language switch to French renders translated keys, no
  English fallback strings visible.
- **Non-Person item**: attach the block in admin to an article item,
  visit the article page — block renders nothing, no console errors.

## 15. Roadmap impact

The "Per-entity page block" item on `ROADMAP.md`'s "Next up" list is
partially satisfied: Persons are the first entity type covered. Other
types (`Organisations`, `Lieux`, `Sujets`, `Événements`) will reuse:

- The generator scaffolding (filter `index.Type`, same join & TF-IDF
  code)
- `C.network`
- The orchestrator skeleton (`person-dashboard.js` becomes a template)
- The facet bar (for Places: location type; for Subjects: thematic)

No further primitives need adding to ship the four remaining types.

## 16. Open decisions deferred to follow-up

- **Map bubble scaling** — current collection-map panel uses linear
  interpolation from 3 to 28 px. For per-person scales (much smaller
  counts), the same stops may be too aggressive. Will calibrate
  after first render and document in the generator.
- **Network collisions** — if visual inspection shows neighbors
  clumping, add `force.repulsion` or `edgeLength` tuning; leave
  defaults for v1.
- **Locale label for entity `Type` in the network legend** —
  the 5 index types (`Personnes`, `Organisations`, `Lieux`, `Sujets`,
  `Événements`) need locale labels. `item_type_*` already exists but
  refers to content types elsewhere, so v1 adds a separate
  `entity_type_*` namespace in `iwac-i18n.js`. Those keys are
  considered part of the i18n work in section 11, not a deferred
  decision — flagged here only because the name choice ("item_type"
  vs "entity_type") is surfaced at the same edit site.

## 17. Definition of done

- New block visible on Idriss Koudouss Koné item page with all 8
  panels populated from real precomputed data.
- Facet bar cycles cleanly between roles with no refetch.
- Network graph surfaces distinctive (not ubiquitous) neighbors,
  with node colors encoding index `Type`.
- Light/dark toggle fully respected.
- EN/FR locales both render correctly.
- README + ROADMAP updated.
- `generate_person_dashboards.py` documented in `scripts/README.md`.
- All existing blocks still render (no regressions).
