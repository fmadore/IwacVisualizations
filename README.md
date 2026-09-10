# IWAC Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to the [Islam West Africa Collection (IWAC)](https://islam.zmo.de/) digital archive at ZMO. Charts are powered by [ECharts 6](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/), with [d3-force](https://d3js.org/d3-force) driving the interactive item-page networks; the underlying data is either fetched live from the public Hugging Face dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/` (the precompute pipeline reads the **private** full mirror `fmadore/islam-west-africa-collection-full` and requires an `HF_TOKEN` — see `scripts/README.md`).

The module targets the [IWAC theme](https://github.com/fmadore/IWAC-theme). It reads the theme's CSS custom properties at runtime so chart colours and type track the site's configured `--primary` / `--ink` / `--surface` colours and `--font-headings` / `--font-body` stacks, it respects the light/dark toggle via a `MutationObserver` on `body[data-theme]`, and it follows the Internationalisation module's language switching (English / French).

## Status

Every registered block is wired end-to-end with live data — twenty-one page blocks and the template-dispatched resource-page blocks (plus the Item Set Dashboard, which lights up opportunistically where a corpus aggregate exists). The deprecated `iwac-dashboard` migration is complete: all retained visualizations are represented in Omeka blocks; `KnowledgeGraph` and `TopicNetwork` remain intentional exclusions.

| Block | Type | Status | Data path |
|---|---|---|---|
| Collection Overview | page block | **Live** — 14 panels, including source locations | Precompute (`generate_collection_overview.py` + two sidecar generators) |
| Audiovisual Overview | page block | **Live** — 6 panels; sources and countries rank by recordings *or* runtime | Precompute (`generate_audiovisual_overview.py`) |
| Index Overview | page block | **Live** — 7 Section A panels + Keyword Explorer | Precompute (`generate_index_overview.py` + `generate_keyword_explorer.py`) |
| References Overview | page block | **Live** — 16 panels, incl. full-text coverage, per-model LDA topics + semantic landscape | Precompute (`generate_references_overview.py`) |
| Scary Terms | page block | **Live** — seven views: race, trends, country/global counts, co-occurrence, context word cloud, and mentioned-place map | Precompute (`generate_scary_terms.py`) |
| Laïcité | page block | **Live** — fourteen views: overview with the tag-vs-text Venn and per-corpus rights split, annotated timeline (year axis or Gregorian-vs-lunar seasonality), archival dossier, rights-gated KWIC concordance, log-likelihood collocates sliced by source type/corpus/decade/country, token-normalised corpus comparison with per-outlet frame fingerprints, actors & institutions by decade, arenas small-multiples, per-model AI framing against a whole-corpus baseline (with a register chart over readability and lexical richness), MapLibre place map, UMAP semantic map of the press half, cross-outlet circulation of near-duplicate copy, bylines with their coverage denominators, and the bibliography. Scans four subsets (articles, publications, documents, references); counts are never summed across them | Precompute (`generate_laicite.py` + committed `laicite-events.json`) |
| Topic Explorer | page block | **Live** — LDA-30 overview (treemap + topics-over-time, switchable between dominant-topic share and probability-weighted prevalence) + per-topic drill-down (first consumer of `IWACVis.dashboardLayout`) | Precompute (`generate_topic_explorer.py`) |
| Periodicals Overview | page block | **Live** — 11 panels: runs gantt, issue-holdings matrix, issues/year, languages & countries donuts, top subjects, word cloud, and LDA themes (mixtures over `lda_topic_topk` — prevalence over time, per-theme ranking, representative issues) | Precompute (`generate_periodicals_overview.py`) |
| Semantic Landscape | page block | **Live** — zoomable UMAP scatter of all 12,286 articles, Country/Decade/Topic facets, topic cluster labels | Precompute (`generate_semantic_landscape.py`) |
| Periodicals Semantic Landscape | page block | **Live** — zoomable UMAP scatter of periodical issues by table-of-contents embedding, Country/Decade facets | Precompute (`generate_periodicals_landscape.py`) |
| Sentiment Atlas | page block | **Live** — corpus-level multi-model AI sentiment: polarity/centralité over time, subjectivity trends, polarity×subjectivity, polarity by country, diverging Likert bars for polarity by topic and by newspaper (share of each row, ordered by net polarity or by volume), centralité-by-country heatmap, extreme-article keywords, cross-model agreement | Precompute (`generate_sentiment_atlas.py`) |
| Press Language | page block | **Live** — readability / lexical richness / article length over time and by newspaper | Precompute (`generate_lexical_metrics.py`) |
| Spatial Exploration | page block | **Live** — world bubble map + country / administrative choropleths + 6-country focus + entity picker (persons / organizations / events / subjects / places) with per-place item popovers | Precompute (`generate_spatial_exploration.py`) + existing per-entity dashboard fan-outs |
| Entity Networks | page block | **Live** — cross-type co-occurrence graph (precomputed ForceAtlas2 layout) + geographic co-mention network, both rendered with MapLibre GL | Precompute (`generate_entity_networks.py`) |
| Compare Newspapers | page block | **Live** — side-by-side comparison of two corpora (whole country or single newspaper): timeline, subjects, sentiment, word clouds, split-corpus choropleth | Precompute (`generate_compare_newspapers.py` per-corpus bundles) |
| On This Day | page block | **Live** — almanac of items published on today's date across the decades, with scans and ledes; Gregorian / Hijri calendars, three reader-switchable layouts, full-day disclosure; removes itself silently without data | Precompute (`generate_on_this_day.py`, 366 + 360-file fan-out) |
| Press Bylines | page block | **Live** — byline-coverage cards, signed-share-over-time, top-25 bylines with authority click-through | Precompute (`generate_press_bylines.py`) |
| Islamic Organisations Co-occurrence | page block | **Live** — sliding-window context matrix per organisation (UIB / CNI / COSIM / CSI / FAIB / UMT) on the shared `C.heatmapMatrix` | Precompute (`generate_org_cooccurrence.py` + curated targets sidecar) |
| Term Trends | page block | **Live** — the "IWAC Ngram viewer": search any of 5,000 lemmas, overlay up to 8, share-of-articles vs counts | Precompute (`generate_term_trends.py`; per-letter shards fetched lazily) |
| Distinctive Vocabulary | page block | **Live** — keyness (log-likelihood + BH correction, ranked by log-ratio effect size) per country / decade, plus Kleinberg burst detection on subject coverage | Precompute (`generate_keyness.py`) |
| Press Reprints | page block | **Live** — cross-newspaper near-duplicate pairs (wire copy / reprints), circulation network + pair table | Precompute (`generate_reprints.py` over `embedding_OCR`) |
| Visualizations / Audio (template 9) | resource-page block | **Live** — minimal-item dashboard (runtime figures + sibling sparkline + similar-items strip), scoped to the item's publisher | Precompute (`generate_template_summary.py`) |
| Visualizations / Video recording (template 19) | resource-page block | **Live** — same minimal-item dashboard, audiovisual subset, scoped to the depositing body | Precompute (`generate_template_summary.py`) |
| Visualizations / YouTube video (template 23) | resource-page block | **Live** — same minimal-item dashboard scoped to the item's **channel**: that channel's uploads over time, its totals and median runtime, its recent videos with thumbnails and durations, plus a link to the canonical watch URL | Precompute (`generate_template_summary.py`) |
| Visualizations / Document (template 22) | resource-page block | **Live** — same minimal-item dashboard, documents subset | Precompute (`generate_template_summary.py`) |
| Visualizations / Photograph (template 15) | resource-page block | **Live** — minimal-item dashboard over the `images` subset, with *real* neighbours: multimodal `embedding_image` cosine similarity instead of a recency list | Precompute (`generate_template_summary.py`) |
| Visualizations / Person | resource-page block | **Live** — 11 panels | Precompute (`generate_person_dashboards.py`) |
| Visualizations / Entity (Lieux, Organisations, Sujets, Événements) | resource-page block | **Live** — reuses Person panels | Precompute (`generate_entity_dashboards.py`) |
| Visualizations / Article (bibo:Article, template 8) | resource-page block | **Live** — 4 panels incl. 3-layer context network + semantic neighbours | Precompute (`generate_article_dashboards.py`) |
| Visualizations / Publication (bibo:Issue, template 21) | resource-page block | **Live** — stat cards + periodical-run sparkline + nearest issues in the run + semantic neighbours (auto-elided until upstream ToC coverage grows) | Precompute (`generate_publication_dashboards.py`) |
| Visualizations / Reference (templates 10–14, 16–18) | resource-page block | **Live** — stat cards + machine topic + `reviewOf` relation + bibliography-timeline sparkline + nearest works + the press coverage the work resembles | Precompute (`generate_reference_dashboards.py`) |
| Item Set Dashboard | resource-page block | **Live** — opportunistic: renders the matching compare-newspapers corpus aggregate (newspapers / periodicals / countries); silently removes itself elsewhere | Reuses `generate_compare_newspapers.py` output |

Current version: see `config/module.ini` (`version = …`). This value drives the `?v=` query string Omeka appends to every asset URL, so bumping it is the canonical way to bust the browser cache after a source change.

Full version history: **[CHANGELOG.md](CHANGELOG.md)**.

## Features

### Collection Overview (page block)

A bird's-eye summary of the whole IWAC collection, designed to drop onto a site page. 14 panels total:

- **Summary row — 11 cards**: Articles, Index, Total words, Total pages, Scanned pages, Unique sources, Document types, Audiovisual minutes, References, Countries, Languages
- **Recent additions table** — thumbnail / title / source / type / date, client-paginated 20 per page
- **Growth** — monthly additions bar + cumulative line (dual axis)
- **Types over time** — stacked bar with country facet
- **Countries covered** — horizontal bar
- **Languages** — horizontal bar with global / by-type / by-country facets
- **Top entities** — tabbed bar (Persons / Orgs / Places / Subjects / Events), 50 per type with client pagination at 10/page; bars click through to the Omeka entity page
- **Gantt** — newspaper coverage periods (start → end) with country and type facets
- **Word cloud** — `echarts-wordcloud` with a horizontal-bar fallback; facets for global / by country / by year; lazy-loaded via `IntersectionObserver`
- **World map** — MapLibre bubbles from `index.Lieux` entries with a type facet; lazy-loaded; GeoJSON plumbed for future choropleth
- **Source locations** — MapLibre bubbles for source repositories/platforms and a ranked source table, ported from the deprecated dashboard’s Sources Map

### Index Overview (page block)

Two complementary sections bundled in one block.

**Section A — Entity Index Explorer** walks the IWAC authority index (~4,385 entities of type Personnes / Lieux / Organisations / Sujets / Événements):

- **Summary row** — total entities, per-type counts, total mentions, time span, places with coordinates
- **Entities by type** — donut chart
- **Most frequent entities in Dublin Core Subject and Spatial Coverage** — tabbed horizontal bar (5 tabs, paginated 10/page, 50/type), each bar clicks through to the Omeka entity page
- **Lifespan × frequency** — scatter of every entity with both a first and last occurrence; x = span years, y = total mentions, color by type; click → entity page
- **Places map** — MapLibre with two toggleable layers: **authority pins** (every place in the index with parseable coordinates, ~555 places) and **mention bubbles** (how often each place is tagged in an item's dct:spatial field, joined back to authorities by name, ~541 resolved). Click → place page via `siteBase + '/item/' + o_id`.
- **Temporal extent** — gantt of first→last year each entity appears (top 30 per type, type facet)
- **Index table** — searchable, type-faceted, paginated (25/page) table of every entity with frequency, year span, and countries; click → entity page

**Section B — Keyword Explorer** is a vanilla-JS port of [iwac-dashboard's `/keywords` route](https://github.com/fmadore/iwac-dashboard/tree/main/src/routes/keywords), generalized to scan every content subset (not just articles):

- Type tabs: **Subjects** (dcterms:subject) / **Spatial Coverage** (dcterms:spatial)
- Facet sidebar — Global / By country / By newspaper — the newspaper dropdown always lists only newspapers that have precomputed keyword series (no dead entries)
- View modes: **Top frequent** (3 / 5 / 10) and **Compare** (search + multi-select up to 10 keywords)
- Multi-series line chart with adaptive tick density (≤ 10 years every year, ≤ 20 every 2nd, ≤ 40 every 5th, otherwise every 10th), bisect-x tooltip, subject-to-surface halo on labels
- All-keywords table with client search and 20-row pagination; each row has an Add → compare-mode action
- **Rising and falling subjects** (v1.21.0) — bump chart of the decade top-8 subject ranks derived client-side from the subjects bundle; lines break where a subject drops off the chart
- **Geographic attention over time** (v1.21.0) — always-on 6-country choropleth with year slider + play, from the spatial bundle; the color ramp is pinned to the all-years maximum so shades compare honestly across years
- Counts reflect **item-level tagging**, not text occurrence: a document tagged with "Terrorisme" contributes exactly one mention per year regardless of how often the word appears in the body. The section subheading says so.

Section A is backed by `asset/data/index-overview.json` (chart aggregates, **186 KB** minified) plus `index-overview-table.json` (the 4,385 table rows, **567 KB**, fetched only when the table panel nears the viewport) — both written by `scripts/generate_index_overview.py` since the v1.6.0 split. Section B is backed by three files — `keyword-explorer-subjects.json`, `keyword-explorer-spatial.json`, `keyword-explorer-metadata.json` — generated by `scripts/generate_keyword_explorer.py` (~1 MB total minified), fetched on-view when the Keyword Explorer section approaches (v1.3.0). Net effect: the block's eager payload dropped from ~1.9 MB to ~190 KB. State is in-memory only; filters reset on reload (page blocks can be embedded anywhere, so hijacking the page URL for block-local state is explicitly avoided).

### References Overview (page block)

Bibliographic dashboard over the `references` subset (867 rows), backed by a precomputed bundle (`asset/data/references-overview.json`, generated by `scripts/generate_references_overview.py`). It began life as the live-fetch exemplar that paged the HF `datasets-server /rows` endpoint at every visit (9 parallel requests + client-side aggregation); the move to precompute makes repeat visits one cacheable JSON. 16 panels:

- Summary cards — references / authors / publishers / types / languages / countries
- "Period covered" subtitle
- Timeline — stacked bar of references per year, by type
- Reference types, languages, countries studied — horizontal bars / pie
- Top authors, top publishers, top subjects — horizontal bars
- References breakdown — country → type treemap
- **Full-text coverage** — how many references have extracted `OCR`, by genre of scholarship, with the denominators spelled out in the panel description (not just a tooltip) because the topic panels below describe only the digitised subset. Also reports `OCR_is_public`: how many of these references have their text published on islam.zmo.de, which is a different quantity from what this module can analyse (it reads the private full mirror).
- **Scholarly topics** — one horizontal-bar panel *per LDA model*, hovering a bar for the references most typical of that topic. Deliberately not merged into a single panel: `references` is topic-modelled twice — `lda_model_references` (French) and `lda_model_references_en` (English) — and both write the same `lda_topic_*` columns, so topic 3 exists twice with unrelated meanings. The generator keys on `(lda_model_name, lda_topic_id)`; aggregating on the id alone would fuse a French topic with an English one.
- **Semantic landscape of the literature** — UMAP scatter of every reference carrying an `embedding_OCR`, colour-faceted by type / country / decade, click-through to the reference. The bibliography's counterpart to the Semantic Landscape block, as a panel rather than a block: at ~423 points it is one view among several here, not a destination of its own. Same recipe as `generate_semantic_landscape.py` (cosine metric over L2-normalised 768-dim `gemini-embedding-2` vectors, fixed `random_state`), but a **separate projection** — coordinates are not comparable across the two maps. `n_neighbors` defaults to 10 rather than 15: at a few hundred points the larger neighbourhood smooths away exactly the local structure a small map exists to show. Coverage is stated in the panel description because a scatter of every point *looks* exhaustive — it covers only the ~423 of 867 references with extracted full text, and that half is not a random sample but what the collection could obtain and digitise. Degrades to a documented empty-state contract (with the reason surfaced) when `umap-learn` is absent or too few references are embedded, so a bibliography refresh never fails on an optional dependency. `--no-landscape` skips the UMAP pass, which dominates the generator's runtime.
- Reference provenance — MapLibre bubble map when provenance labels can be resolved against geocoded IWAC authority places; otherwise a documented empty-state contract
- Subject co-occurrence — chord graph from pipe-separated reference subjects
- Author collaborations — force-directed co-authorship network

The deprecated dashboard’s `KnowledgeGraph` and `TopicNetwork` visualizations are intentionally not ported into this module; no routes, generators, data contracts, dependencies, or UI strings should be added for them.

### Scary Terms (page block)

Tracks the frequency of a curated set of "scary" term families (terrorisme, extrémisme, djihadisme, intégrisme, …) across the IWAC corpus from 1961–2025. Seven view modes since v1.21.0:

- **Metric row** — total matching articles, term families, variants, total occurrences
- **View mode switcher** — Bar-chart race / Trends / By country / Global / Co-occurrence matrix / Word cloud / Map
- **Animated bar-chart race** — horizontal bars animated one year at a time (1 s per frame), term families cycled through IWAC palette colors
- **Trends** (issue #2) — per-family time series with hand-curated historical-event annotations (`markLine` verticals + the Algerian Civil War `markArea` band from the committed `scary-terms-events.json`; country-scoped events appear only under that country's filter), events toggle, `<details>` events list
- **Country view** — per-country breakdown selectable via dropdown
- **Global view** — single time-series of total occurrences
- **Co-occurrence matrix** — term × term heatmap, global or per-country
- **Word cloud** (issue #4) — document-frequency vocabulary of matching articles (global / by family / by country / 5-year buckets; the scary variants themselves excluded), with the shared hbar fallback and a `<details>` word table
- **Map** (issue #3) — MapLibre bubble map of the geocoded places tagged on matching articles (295 places ≥ 3 articles), family / article-country filters, item-linked popups, `<details>` places table
- **Term definitions table** — each family with its variants, for provenance

Backed by seven precomputed JSONs from `scripts/generate_scary_terms.py` (metadata / temporal / countries / global / cooccurrence eagerly; the trends sidecar small and eager with graceful fallback; wordcloud + places lazy-fetched on first view activation) plus the committed `scary-terms-events.json` annotation sidecar.

### Topic Explorer (page block)

LDA-30 topic overview of the IWAC `articles` subset. The block has two modes that share the same container:

- **Overview** — summary cards (total topics, articles classified, outliers, newspapers), a clickable **treemap** of all 30 topics sized by article count, a **topics-over-time** stacked area, and a responsive grid of **topic cards** (each carrying the top 5 words, article count, and year span). Clicking either a treemap cell or a card swaps to that topic's detail view.
- **Two weightings of topics-over-time**, switchable from a facet bar, because they answer different questions. *Dominant topic* is the original 100%-stacked share of the articles a topic was the single best label for. *Probability-weighted* uses `lda_topic_topk` to plot the mean probability mass per year, so an article the model splits 0.34/0.33/0.33 contributes to all three of its topics instead of counting wholly for one. The weighted view is deliberately **not** normalised to 100%: only each article's top 3 topics reach the Hub (the full θ matrix is dropped before the push), so the stack tops out near the captured mass (~85%) and the headroom *is* the unrecorded tail. Renormalising would turn a known partial measurement into a fake complete one. Each view carries its own caveat line, and the switch appears only when the bundle has a `prevalence` block — a dataset predating the 2026-07 LDA re-run keeps the single original view.
- **Per-topic detail** — a **publication calendar**, top **countries** and top **newspapers** as horizontal bars, and the top 10 **most representative articles** (similar-items strip sorted by `lda_topic_prob` and click-through to each article's page).
- **Three calendar granularities**, switchable from a facet bar on the calendar panel. *By month* (default) is a Gregorian year × month grid: 12 fixed rows, one column per year. *By day* is the original per-day calendar, one block per year — it still surfaces the burst around a single event, but a 35-year topic renders ~6,300 px tall and almost entirely empty, which is why it is no longer the default. *By Hijri month* converts each publication date with the Umm al-Qura tables so Ramadan and Dhu al-Hijja hold still as rows instead of drifting eleven days a year across the Gregorian grid — a topic with a Ramadan-heavy rhythm reads as one bright row rather than a diagonal smear. All three are client-side folds of the same `day_cells` array, so the Hijri view needs no generator change. The Hijri facet is dropped when the browser's `Intl` lacks Islamic calendar data, and carries a caveat line: West African month boundaries were set by local moon sighting and often fell a day either side of the tabular date.
- **Deep links** — drilling into a topic writes `?topic=<id>` to the address bar, so a topic view can be cited, bookmarked, or pasted into an email. Loading such a URL opens that topic directly (via `replaceState`, so Back leaves the page rather than bouncing through an overview the reader never saw); Back/Forward move between the overview and topics; a *Copy link* button in the detail header makes the URL discoverable. Every step degrades to a no-op where `history`/`URL` are unavailable or a sandboxed embed forbids them, and an unknown `?topic=` value falls back to the overview.

This is the first end-to-end consumer of the v0.16.0 declarative dashboard-layout system: the per-topic detail view is registered once as `topicDetail` (a four-slot array) and dispatched via `IWACVis.dashboardLayout.render(detailEl, 'topicDetail', sliceBundle, ctx)`. The four slots map to the `calendarHeatmap`, `horizontalBar` (used twice with different `dataKey`s), and `similarItems` renderers — `horizontalBar` was added as the eighth shared renderer for this block.

Backed by `asset/data/topic-explorer.json` (single bundle, generated by `scripts/generate_topic_explorer.py`). Outlier articles (`lda_topic_id == -1`, ~2 %) are excluded from per-topic stats but counted in corpus metadata.

### Visualizations (resource-page block) — Person

Per-Person resource-page block that renders when attached to an item whose resource template is `Personnes` (template ID 5). 11 panels:

- **Summary stats row** — total mentions, year range, newspapers, countries
- **Global role facet** — `All / As subject / As creator / As editor` — re-filters every panel below with no refetch
- **Mentions timeline** — year × country stacked bar
- **Year × month heatmap**
- **Top newspapers** — horizontal bar with year-range tooltip (panel elided when empty)
- **Countries covered** — horizontal bar
- **Top LDA topics** — horizontal bar (panel elided when empty)
- **AI sentiment** — one bar set per rating model, from the bundle's own `models` array (panel elided when empty)
- **Associated entities network** — TF-IDF ranked force graph (`score = cooc × log(N_persons / df)`, `min_cooccurrence = 2`, top-50 cap), nodes colored by index `Type`, click → Omeka entity page; ships a custom toolbar (zoom +/−, reset, legend toggle, download)
- **Subject co-occurrence** — pairwise co-occurrence among top 15 neighbors
- **Associated locations map** — MapLibre bubbles from mentioned `Lieux` entities, sized by count

Data comes from one JSON per person under `asset/data/person-dashboards/{o_id}.json`, generated by `scripts/generate_person_dashboards.py` using the `articles`, `publications`, `references`, and `index` HF subsets.

### Visualizations (resource-page block) — Entity

Same block layout, same template dispatch. When attached to an item whose template is `Lieux` (6), `Organisations` (7), `Sujets` (3), or `Événements` (2), `Visualizations::render()` routes to `entity.phtml`, which reuses every Person panel module with `by_role.all` wrappers (no role facet). Data comes from `asset/data/entity-dashboards/{o_id}.json`, generated by `scripts/generate_entity_dashboards.py`.

### Visualizations (resource-page block) — Article

Attaches to `bibo:Article` items (template id 8 on islam.zmo.de). `Visualizations::render()` routes to `article.phtml`, which loads the per-article JSON at `asset/data/article-dashboards/{o_id}.json` (generated by `scripts/generate_article_dashboards.py`, one file per article, ~12,287 files / ~120 MB). 4 panels:

- **AI sentiment** — a comparison of every rating model in `SentimentExtractor::MODELS` for THIS article, read straight from the Omeka item metadata by `SentimentExtractor` (not from the precomputed bundle), so editorial changes on islam.zmo.de show immediately — and so a model whose corpus pass is still running shows up on the articles it has reached and nowhere else. One block per axis — polarity, centrality, subjectivity — each a five-stop ordinal scale with its poles named and one lane per model, so agreement reads as vertical alignment; a verdict line states the spread in words, and a per-axis drawer puts the models' rationales for the same question side by side. The panel description names the models that rated the article in hand rather than a fixed roster. Server-rendered CSS, no chart library. Panel elided entirely when no model rated the article; a lane is elided when that model left that axis empty, and an off-scale "Not applicable" polarity shows the word with an empty track rather than a rating of zero.
- **Context network** — the unified 3-layer force graph. Centre = the article, inner ring = its tagged persons / orgs / places / subjects, outer ring = the top 20 articles that share the most entities with it. Each related-article node is connected to every entity it shares with the centre, so ECharts' force layout clusters articles by the entities they overlap with. Click an entity to open its page; click an outer-ring article to jump to that article's dashboard (self-reinforcing feedback loop). The panel ships the same 6-button toolbar (zoom ±, reset, legend, download, fullscreen) as the person / entity networks.
- **Similar articles** — top 10 articles by cosine similarity of the precomputed `embedding_OCR` (768-dim Gemini). Horizontal bar chart with similarity as a 0–100% x-axis so the long-tail drop-off is legible at a glance. Tooltip shows full title + newspaper + date + similarity; bar click routes to the article page.
- **In the scholarship** (third tab of Further reading) — the top 5 works from the `references` subset by cosine similarity, i.e. the academic literature whose text most resembles this newspaper article. Possible because the 2026-07 pipeline gave the bibliography `embedding_OCR` from the *same* `gemini-embedding-2` model, in the same 768-dim space, so the dot product is meaningful across subsets. This archive is unusually well placed to answer that question — a press corpus and its own secondary literature in one embedding space. The panel copy calls it a lead to follow rather than a citation. The tab appears only when the key is present; the generator omits it entirely when the bibliography has no embeddings.

  **Hubness correction** (v1.24.1). Chunk-averaging a long document pulls it toward the corpus centroid, and the first real run showed exactly that: one interview surfaced for 38% of all articles, a survey for 32%. A similarity floor cannot fix this — a hub is close to *everything* by construction, and those two sat inside a distribution whose median top-1 was 0.691, so any threshold high enough to exclude them would delete the legitimate matches first. Each reference is therefore penalised by its **mean cosine across the whole article corpus** before ranking. CSLS was tried first and does nothing here: it penalises by the mean cosine to a reference's *k nearest* articles, and a genuine specialist's ten nearest articles are all in its own tight cluster, so its local density matches the hub's and the top pick changed for zero articles. What separates a hub from a specialist is not how close its closest neighbours are but how close everything is, which only the global mean sees. On a planted-hub fixture the correction moves hub dominance from 99% of articles to 1% while specialists go from 1% to 98%, and articles with no good specialist still get an answer rather than a gap. The **displayed** percentage stays the raw cosine and cards are re-sorted by it, so the badge means what a reader takes it to mean; the correction decides which works appear, not what the number says.
- **Spatial coverage** — MapLibre map with one pin per place in the article's `dcterms:spatial` field, geocoded through the IWAC authority index. Uniform pin radius (all counts = 1); popup links to the place's authority page. Auto-fits the viewport to the pins.

The 3-layer network is built client-side in `network.js` from the precomputed `entities` + `related_by_entities` arrays (no separate `network` key in the JSON — saves ~3 KB per file). Reuses `C.network` unchanged: the builder is topology-agnostic, so adding `type: 'article'` for the outer ring just picks up the next palette colour and a new legend entry via the `entity_type_article` i18n key.

### Visualizations (resource-page block) — Reference

Attaches to the eight reference templates (10 Book, 11 Book chapter, 12 Book review, 13 Report, 14 Thesis, 16 Blog post, 17 Communication, 18 Journal article — the nine resource classes of the `references` subset). Loads `asset/data/reference-dashboards/{o_id}.json` (`scripts/generate_reference_dashboards.py`, 867 small files).

References were the last content type without this block, and correctly so until 2026-07: a bibliographic record held nothing a chart could add over Omeka's own item page. The pipeline's full-text pass changed the arithmetic — `OCR`, `embedding_OCR`, LDA topics and `nb_mots` — so the dashboard now shows what the item page cannot:

- **Stat cards** — type, authors, year, publisher, pages, words, language, DOI (missing cards elided).
- **Topic line** — the LDA label, deliberately *not* a stat card: it needs a qualifier a card has no room for. The words are machine-generated, and the bibliography is modelled twice (French + English) over shared `lda_*` columns, so a topic is only interpretable alongside the model named in the tooltip.
- **`reviewOf` relation**, resolved in both directions: what this work reviews, and which works in the bibliography review it. Title matching is NFC + case-folded; an unresolved target still renders as plain text, so a review of a book the collection doesn't hold still says what it reviews. Rendered as prose, not a chart — it is a bibliographic fact about two works, not a measurement.
- **Bibliography sparkline** — where the work sits in the bibliography's own publication timeline. Whole-subset rather than per-publisher: publisher values are too sparse here for a per-imprint run to mean anything.
- **Closest works** — cosine neighbours over `embedding_OCR`.
- **Press coverage this resembles** — the reverse of the article dashboards' scholarship bridge: one long work ranked against 12k short articles, which is the "what did the papers say about this" question. Same leads-not-citations caveat in the panel copy.

Coverage is partial by nature (~423 of 867 references have extracted text), so every block is independently omittable, and a missing per-item JSON **removes the block** rather than showing an error — for half the bibliography that is the normal state, not a failure.

### Periodicals Overview (page block)

Corpus-level view of the Islamic press (`publications` subset, 1,501 issues across 25 periodicals, 1981–2024). Backed by `asset/data/periodicals-overview.json` (`generate_periodicals_overview.py`): summary cards, a periodical-runs gantt (first → last issue per title, colored by country), issues-per-year stacked by country, languages and countries as donuts, top subjects, and a word cloud of the most frequent lemmatized terms across every issue's full text (`lemma_nostop`).

**Themes (LDA) — mixtures, not labels.** Three further panels read `publications.lda_topic_topk` (`lda_model_publications`, k=20, chunked; covering 1,451 of 1,501 issues — the rest are the two Arabic issues and those without usable OCR, which are **null**, not `-1`): prevalence over time, a per-theme ranking, and representative issues. Unlike the articles Topic Explorer this block offers **no dominant-topic view**, because mean dominant-topic probability here is **0.345** — a whole periodical issue is a miscellany, and "this issue is about topic 14" is false about two thirds of the time. The stacked area is deliberately **not** normalised to 100%: only each issue's top k=3 are on the Hub, so the stack tops out at the captured mass (~65%) and the headroom is the tail the data does not carry. Representative issues are ranked by *that theme's* share of each issue rather than by `lda_topic_prob`, and capped at three per periodical — without the cap, 8 of 20 themes returned ten issues of a single title, presenting a theme carried by 16 periodicals as if it belonged to one magazine. Topics come from the issues' **OCR text**, while the subset's embedding is built from the **table of contents**; the panels state that rather than letting the two be read as one signal.

### Semantic Landscape (page block)

The "map of everything": a zoomable scatter of all 12,286 articles placed by UMAP over their 768-dim Gemini `embedding_OCR` (cosine metric, fixed seed). Color facets: Country / Decade / Topic (top-12 LDA topics + Other). Axes are hidden — only proximity means anything, and the panel description says so plainly. Click any point to open the article. Backed by `asset/data/semantic-landscape.json` (columnar, ~1 MB minified / ~300 KB gzipped — the heaviest single bundle in the module, loaded on-view only on pages carrying the block; `generate_semantic_landscape.py`, requires `umap-learn`).

### Periodicals Semantic Landscape (page block)

The publications counterpart to the Semantic Landscape: a zoomable UMAP scatter of periodical **issues** placed by their 768-dim Gemini `embedding_tableOfContents` (cosine metric, fixed seed). The `publications` subset carries no LDA topics, so color facets are **Country / Decade only**. Click any point to open the issue. Backed by `asset/data/periodicals-landscape.json` (`generate_periodicals_landscape.py`, requires `umap-learn`) and rendered by the shared `semantic-landscape.js` orchestrator (publications variant, selected from the `iwac-vis-periodicals-landscape` block class). Note: `embedding_tableOfContents` only exists for issues that have a table of contents (~325 of 1,501), so the map plots that subset.

### Sentiment Atlas (page block)

Corpus-level view of the AI sentiment ratings that would otherwise only be visible item-by-item. The roster comes from the bundle — `generate_sentiment_atlas.py` publishes only the models the loaded snapshot has Hugging Face columns for, so a model being annotated on Omeka appears here at the first regeneration after its column lands, not before. A global model facet drives polarity and centralité-of-Islam over time, polarity by country, a polarity × subjectivity breakdown, and a centralité-by-country-and-year intensity heatmap; an extremes section shows the subject/place keywords most frequent among the articles a model rated at the ends of each scale; a subjectivity trend overlays every model at once (the only panel that does, hence the `--iwac-vis-model-*` colour tokens); and a model-pair facet drives cross-model agreement (pairwise rates + a polarity cross-tab — one card per unordered pair, so the section grows quadratically with the roster: 3 models give 3 cards, 4 give 6). Every panel is explicitly labelled as AI-generated assessment, per the module's convention for computational artefacts.

Every cut recomputes from Hugging Face via `generate_sentiment_atlas.py` (≈ 40 KB bundle).

### Press Language (page block)

"The language of the press": readability (Flesch FR), lexical richness (MATTR — moving-average type-token ratio over a 50-word window, so it is not biased by article length; articles under 50 words are unscored), and article length over time and by newspaper, from the dataset's precomputed OCR text metrics. Backed by `generate_lexical_metrics.py`.

### Distinctive Vocabulary (page block)

Two corpus-linguistics views that the other blocks cannot express, from one bundle (`asset/data/keyness.json`, `scripts/generate_keyness.py`). Both read columns the dataset already carries, so neither needed new enrichment.

**Keyness** — the vocabulary a country or a decade uses *more than the rest of the collection does*, over `lemma_nostop`, with a Country / Decade facet and one slice shown at a time. This is a different question from Term Trends: that block plots how often a word is used, this one plots where it stands out.

The method matters, because the obvious implementation is wrong. Dunning log-likelihood (G²) grows with corpus size as well as with effect strength, so ranking by G² returns the biggest slice's most frequent words — the classic keyness mistake. Here G² is used **only as the significance test** (p = χ²(|G²|, df 1), Benjamini–Hochberg corrected within each slice's tested token family), and surviving tokens are ranked by **Hardie's log ratio** effect size. On top of that, a **minimum effect size** (default log₂ 1.5, i.e. a 1.5× rate) drops the significant-but-trivial: on a corpus this size a 1.1× difference clears q < 0.001 easily, and a slice with no real signature vocabulary would otherwise fill its whole top-25 with such terms — which a reader fairly takes to mean "these words characterise this slice". The sibling pipeline's CSV export applies no such floor, deliberately, since an analyst reading a CSV can filter and a panel reader cannot. Slices with nothing left are still listed, with an empty bar chart: "no distinctive vocabulary" is a finding, and dropping the slice would read as missing data. The panel caption carries the subcorpus size, because "distinctive of Niger" over 300 articles and over 3,000 are different strengths of claim.

**Subject bursts** — the years in which a controlled-vocabulary subject was tagged far above its own long-run rate, via Kleinberg's 2-state automaton. This is event detection: it finds the moments the press suddenly cared about something without being told what to look for. Drawn on the shared gantt, **one row per burst rather than per subject** — a subject the press returned to twice had two episodes, and collapsing them into one span from first start to last end would invent years of intense coverage that never happened. The year axis is a contiguous calendar range with empty years zero-filled, so a burst can legitimately span a gap in the corpus instead of being split by it, and the automaton's log(T) horizon reflects the real span.

**Burst threshold: `s = 3.0`** (raised from the reference implementation's 2.0 in v1.24.2). A burst means a subject ran at *three* times its own long-run rate, not twice. The basis is measured: simulating pure Poisson subjects — constant underlying rate, no real burst anywhere — over this corpus's year-volume profile, spurious bursts fall from ~**15% of subjects at `s=2.0`** to ~**6% at `s=3.0`** and ~2% at 4.0. At 2.0, 325 of 341 tested subjects burst; noise explained only about a sixth of that, the rest being real (coverage in a press archive genuinely concentrates around events), but "twice its own average at some point in 65 years" is true of nearly every subject and so says little. 3.0 clears most of the noise floor while keeping the threshold recognisable as "much more than usual"; 4.0 starts demanding a quadrupling and reports only the largest few events.

Checked against the shapes that matter before changing it: a sharp event returning to baseline, a two-year event, and a late surge still rising all still fire at 3.0 (with larger weights, since the burst state sits further from the base rate); a modest 1.5× rise and a flat series still produce nothing.

**What raising it actually achieved, measured after the fact:** almost nothing to the *rate* — subjects with a burst went 325 → 323 of 341, and 95% is unchanged. That is the strongest evidence yet that the figure describes the archive rather than the threshold: even demanding three times a subject's own average, essentially every subject qualifies somewhere across 65 years, because press coverage concentrates around events. No realistic `s` will make that number small, and pushing further would start deleting real episodes. What the change *did* do is re-scale burst weights, so the top-40 is now ranked by 3×-relative strength rather than 2× — the ordering shifts rather than the list merely shortening.

A **vocabulary-onset rule** also ships: a burst starting at a subject's first occurrence *and* ending at the corpus's last year is its arrival in the index rather than a change in coverage, and is dropped. It was introduced to explain the 95% and does not — it fires on zero subjects in the real corpus. It is kept because the rule is right in principle, but it is not load-bearing. (An earlier attempt restricted the automaton to each subject's own active span; that suppressed the artefact too, but discarded the sharpest signals in the corpus, since a subject tagged only in 2003–04 has a two-year span that is flat within itself and bursts nowhere.)

The statistics live in `scripts/iwac_stats.py` (BH correction, G², log ratio, Kleinberg), ported from the pipeline's `analyses/_stats.py` + `analyses/keyness_bursts.py` rather than imported: that repo is the data pipeline, not a dependency of this module, and its outputs reach us only through the Hub. The χ² tail is computed as `erfc(sqrt(x/2))` — an identity for df = 1, not an approximation — which keeps SciPy out of `scripts/requirements.txt` and stays accurate deep in the tail where `1 - cdf` would cancel to zero.

### Spatial Exploration (page block)

"Where the collection looks": a world bubble map of all 543 geocoded places in the authority index (bubble size = mention frequency), with an entity picker sidebar covering the full index — Persons (2,707), Organizations (398), Events (222), Subjects (209), Places (664) — behind accent-insensitive search. Selecting an entity re-scopes the map to the places mentioned alongside it; hover previews the first related items, click pins the full paginated item list with links to the Omeka items. A country-focus select zooms and filters to one of the six IWAC countries, and the shared choropleth toggle fills countries with item counts (entity-specific when one is selected). The block's sidecar `spatial-exploration.json` (`generate_spatial_exploration.py`, 148 KB minified) carries places + picker indexes + country counts/bounds; per-entity data comes from the existing `person-dashboards/` / `entity-dashboards/` fan-outs, fetched lazily per selection and LRU-cached.

### Entity Networks (page block)

Co-occurrence networks rendered with MapLibre GL (see the v1.7.0 changelog entry for why not ECharts/Sigma). *Entities* mode draws the cross-type graph — persons↔organizations plus events as connective tissue to every other type — on a blank theme-aware canvas, with positions precomputed by ForceAtlas2 at generation time (`generate_entity_networks.py`, 1,554 nodes / 7,356 edges at co-occurrence ≥ 2). *Places* mode draws co-mentioned places over the basemap (508 nodes / 11,030 edges, lazily fetched). Node color = entity type (module palette), size = items mentioning it; labels collide via symbol layers with a hubs-first priority rank. Type chips, a min-link-strength select, and node search filter the view; clicking a node highlights its neighborhood and lists its strongest co-occurrences in the details sidebar.

### On This Day (page block)

The module's one deliberate engagement hook: an almanac of newspaper articles and periodical issues published on today's date across the collection's decades — a 1971 Togo-Presse graduation piece next to a 2020 Ramadan report — each entry carrying its page scan and a line of its text, and linking to its item page.

**Two calendars.** A Gregorian / Hijri switch runs the same day through both, and each picks its own documents: the same lunar date across the decades is a different set of items from the same solar date. `generate_on_this_day.py` writes both fan-outs — `on-this-day/{MM-DD}.json` (366 files) and `on-this-day/h/{MM-DD}.json` (360, Umm al-Qura), ~7 KB median. The lunar dates are **read from the dataset's `hijri_year` / `hijri_month` / `hijri_day` columns**, not recomputed, so the site's buckets and the published dataset cannot drift apart. Only the *current* date is converted in the browser; each item's Hijri year is written into the data, because ICU's tables and the stored Umm al-Qura ones disagree on ~42 % of pre-2000 dates and a re-derived label would contradict the file the item is filed under.

**Three layouts, one cast.** *Register* (ruled rows, six documents — the default), *Decades* (five documents pinned along the masthead rule turned time axis) and *Clippings* (eight in a three-column mosaic). The page editor picks the opening layout in the block form; the reader can switch, and the choice is remembered. All three draw from one deterministic eight-item cast, so switching changes the rhythm without swapping the documents out. The cast is bucketed by **year range, not list position** — the corpus is heavily skewed to the 2010s, and equal-count segments would render a block promising "across the decades" as a wall of recent years.

**Absent things are designed for.** Only ~44 % of fully-dated items have a scan, so the image-forward layouts fall back to a typographic catalogue slip at the same footprint rather than a grey box. Article ledes are hunted out of the OCR past mastheads, decks and production stamps, and dropped entirely when no prose turns up; periodical issues use their table of contents or nothing, since an issue's OCR opens on front matter. The footer unfolds the complete day in place — the day file already holds every item — rather than linking to a search that cannot express "this day, any year". The block silently removes itself when the day file is missing, and drops just the calendar switch when the Hijri fan-out is missing, so it is safe on a homepage before the first data sync. Layout breakpoints are container queries, so it survives a narrow column.

### Press Bylines (page block)

Who signed the West African press. Summary cards (signed articles, share of the corpus, distinct bylines, prolific bylines), the share of each year's articles carrying a byline (the remainder ran unsigned), and the top-25 bylines — journalists and press agencies alike — with active spans, top newspapers and frequent subjects in the tooltip. Bars click through to the byline's `Personnes` authority record where the generator resolved one (byline ↔ `index.Titre` + `Titre alternatif`, both sides NFC-normalized). Backed by `asset/data/press-bylines.json` (`generate_press_bylines.py`, ~6 KB).

### Item Set Dashboard (resource-page block)

Newspapers, Islamic periodicals, and countries exist as item sets on islam.zmo.de — and the Compare Newspapers precompute already aggregates each of them. This block reuses those single-corpus JSONs: the orchestrator matches the item set's title against `compare-newspapers/index.json` (newspapers before countries, articles before publications) and renders summary cards + period subtitle, items per year, top subjects, spatial coverage, and most-frequent words (wordcloud with bar fallback). Item sets with no matching corpus remove the block client-side, so it is safe to enable for **all** item sets. Zero additional precompute.

### Visualizations (resource-page block) — Publication

Attaches to `bibo:Issue` items (template 21 — the Islamic periodical issues of the `publications` subset, 1,501 items). `Visualizations::render()` routes to `publication.phtml`, which loads the per-issue JSON at `asset/data/publication-dashboards/{o_id}.json` (generated by `scripts/generate_publication_dashboards.py`). Panels, all declarative `dashboardLayout` slots:

- **Stat cards** — words, pages, issue number, language, country, date (missing values elide their card; range dates like `2009-05/2009-08` display verbatim)
- **Most frequent words in this issue** — word cloud of the issue's own text, from a precomputed `[word, count]` frequency list (source-column priority `lemma_nostop` → `lemma_text` → `OCR`, tokenized server-side through the shared `iwac_utils.tokenize`)
- **This issue in its periodical run** — sibling sparkline of issues-per-year for the same periodical (`newspaper` is clean in this subset, so the per-periodical slice is honest), with this issue's year dotted
- **Similar issues** — semantic neighbours by cosine similarity over `embedding_tableOfContents` (768-dim Gemini). This replaced the earlier chronological "other issues of this periodical" strip now that the table-of-contents embeddings cover the subset — regenerate after each dataset update.

*(No placeholder blocks remain — every registered layout is live as of v1.6.0.)*

## Architecture, build and development

The file layout, the asset partial, the two data paths and how generated data
reaches the server, plus i18n, theme switching, mobile behaviour and the build
commands all live in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

Two things worth knowing before reading anything else:

- **A block is declared once**, in `src/Site/BlockRegistry.php`. The registry
  is the source of truth for the label, the admin description, the partial
  name and the embed slug; `npm run lint:blocks` fails the build when the
  registry, the config invokables, the `BlockLayout` classes and the templates
  stop agreeing.
- **The precomputed JSON is not in this repository.** It is built in CI,
  published as a release asset and pulled onto the server by an admin job
  (issue #7). `asset/data/` is gitignored apart from two hand-curated event
  sidecars.

## Upgrading to 1.66.0

Existing installed data continues to serve. Before the next **Pull latest data**,
run the updated regeneration workflow successfully: the importer now requires
`manifest.json` and a checksum. The moving `data/latest.json` pointer selects
an immutable `data-build-<run>-<attempt>` release. Explicit tags must also contain
the new archive format; unsigned or manifest-free archives are rejected.

New data lives under `files/iwac-visualizations/generations/<manifest-sha256>/`.
Page markup records its generation so subsequent sidecar requests use the same
snapshot. Previous and recent generations remain available for at least 30 days;
the old legacy tree is preserved during migration. Very old open tabs should be
reloaded after that retention window. Never delete `sync.lock` to clear a stuck
job: use the explicit recovery checkbox in the admin screen, which checks the
worker lock before dispatching a replacement.

To change sentiment models, edit `config/sentiment-models.json`, run
`node scripts/build-model-registry.js`, then `npm run build`. Python reads the
same registry directly. Existing saved layout names remain supported as aliases.

## Installation

Not yet released. For local development:

1. Place this directory (or a clone of the repo) under your Omeka S `modules/` folder.
2. If you plan to regenerate the minified JS bundles or the precomputed data:
   - **Node 22** for the JS build/lint/browser tests: `npm install && npm run build`
   - **Python 3.12** for the precompute pipeline: `python3 -m venv .venv && source .venv/bin/activate && pip install -r scripts/requirements.txt` (the hash-pinned `requirements.lock` is compiled for the Linux runner and will not install elsewhere — see `scripts/README.md`)
3. Regenerate data as needed (see [Precompute pipeline](#precompute-pipeline)).
4. Activate the module in **Admin → Modules**.
5. On any site page, add one of the page blocks (for example **Collection Overview**, **References Overview**, or **Compare Newspapers**). For resource-page blocks (**Visualizations**, **Item Set Dashboard**), attach them to the appropriate resource templates from the admin.

The committed `asset/js/dist/` bundles and `.min.css` sheets mean a fresh clone works without running `npm install` — the Node build is only needed when you change a source.

### Requirements

- **Omeka S 4.0+** (declared in `config/module.ini`; CI boots both the literal Omeka S 4.0.0 floor on PHP 8.1 and the production target, Omeka S 4.2.1 on PHP 8.5)
- **Node 20+** — only needed when rebuilding minified JS bundles or running Playwright (dev/CI step)
- **Python 3.12** — only needed when running the CI-equivalent Python precompute generators. Direct requirements live in `scripts/requirements.txt`; the workflow installs the hash-verified `scripts/requirements.lock`.
- **Theme:** [IWAC theme](https://github.com/fmadore/IWAC-theme). The module works without it (CSS fallback values + ECharts theme fallback constants), but chart colors will look generic and the dark-mode toggle will only follow the OS preference.

### IWAC theme integration

`asset/js/iwac-theme.js::readTokens()` pulls these CSS custom properties off `:root` via `getComputedStyle`, with fallbacks in `FALLBACK_LIGHT` / `FALLBACK_DARK` so charts still render on sites without the IWAC theme:

| Token | Used for |
|---|---|
| `--primary` | First palette color + accents (dataZoom handle, hover borders, …) |
| `--ink` | Primary text |
| `--ink-light` | Axis labels, legend text |
| `--muted` | Secondary text, tabs, subtitle |
| `--surface` | Tooltip background, button background |
| `--surface-raised` | Panel background, card background |
| `--background` | Chart background fill |
| `--border` | Axis lines, panel borders |
| `--border-light` | Split lines, subtle dividers |

If you add new theme-dependent properties, register them in `readTokens()` and provide a fallback in `FALLBACK_LIGHT` / `FALLBACK_DARK`. **Never hardcode hex values in chart code** — the IWAC theme's `--primary` is admin-configurable per site.

## Related projects

- [IWAC Theme](https://github.com/fmadore/IWAC-theme) — the Omeka S theme this module targets
- [iwac-dashboard](https://github.com/fmadore/iwac-dashboard) — deprecated standalone SvelteKit dashboard; retained here as migration provenance only
- [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations) — the module this was scaffolded from
- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection)

## Citation

If you use this module in research, cite it via the `Cite this repository` button on GitHub, or from [CITATION.cff](CITATION.cff) directly.

> Madore, Frédérick. *IWAC Visualizations* (version 1.68.3). University of Bayreuth, 2026. <https://github.com/fmadore/IwacVisualizations>

## License

[MIT](LICENSE) © Frédérick Madore
