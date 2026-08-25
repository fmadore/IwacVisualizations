# PRODUCT.md — IWAC Visualizations

<!--
  Product truth for the Impeccable artifact layer. Visual system: root DESIGN.md
  + .impeccable/design.json. Upstream visual authority (tokens, register,
  North Star) lives in the IWAC theme — see IWAC-theme/DESIGN.md,
  IWAC-theme/docs/DESIGN-SYSTEM.md, IWAC-theme/docs/DESIGN-PHILOSOPHY.md.
-->

## What this is

An Omeka S module that adds interactive visualizations to the **Islam West Africa
Collection (IWAC)** at ZMO Berlin — a francophone West African digital archive of
newspaper articles, Islamic publications, archival documents, audiovisual records
and academic references from Benin, Burkina Faso, Côte d'Ivoire, Niger, Nigeria,
Senegal and Togo.

It is not a standalone dashboard product. It is a **guest inside a host page**: every
visualization renders as an Omeka block on a site that the IWAC theme has already
dressed, and it inherits that page's typography, colour, locale and light/dark state
rather than declaring its own.

Charts are ECharts 6; maps are MapLibre GL; the item-page networks run on d3-force.
Data is precomputed by Python generators against the Hugging Face dataset
`fmadore/islam-west-africa-collection` (private full mirror for the pipeline),
published as a release zip, and unpacked onto the server by an admin job — the client
only ever `fetch()`es a static JSON.

Live: [EN](https://islam.zmo.de/s/westafrica/) · [FR](https://islam.zmo.de/s/afrique_ouest/)

## Who it is for

- **Researchers of Islam in West Africa** — historians, anthropologists, area-studies
  scholars — who need corpus-scale answers (coverage over time, who is discussed
  alongside whom, how framing differs by outlet) that no amount of paging through
  search results will give.
- **Readers of a single record**, arriving on one article, issue, person or place, who
  get that record situated in its corpus without leaving the page.
- **The collection's own curators**, for whom the dashboards double as a coverage
  audit: gaps, skews and thin subsets are visible as shapes.

Both public sites are bilingual (English / French); French is the corpus language and
is never the afterthought locale.

## What it ships

Nineteen page blocks (Collection Overview, Index Overview, References Overview, Scary
Terms, Laïcité, Topic Explorer, Periodicals Overview, two Semantic Landscapes,
Sentiment Atlas, Press Language, Spatial Exploration, Entity Networks, Compare
Newspapers, On This Day, Press Bylines, Islamic Organisations Co-occurrence, Term
Trends, Distinctive Vocabulary, Press Reprints) plus template-dispatched resource-page
dashboards for items, persons, entities, articles, publications, references and item
sets. Blocks are declared once in `src/Site/BlockRegistry.php` and embeddable via a
dedicated route.

## Durable constraints

These bind the design system; they are not preferences.

1. **The theme is the single source of truth for design tokens.** This module consumes
   the theme's published vocabulary through `var(--token, <fallback>)` and a synced
   `tokens.json`. It owns exactly one namespace, `--iwac-vis-`, and only for
   data-encoding colour and module-local layout constants with no theme equivalent.
   Re-declaring a theme token inside that namespace is a bug, and `npm run lint:theme`
   fails the build on it.
2. **Accessibility target: WCAG 2.2 AA.** Text and glyph marks clear 4.5:1 against the
   surface they are drawn on; every interactive control has a visible focus indicator;
   every chart is reachable and named from the keyboard; `prefers-reduced-motion`
   silences chart animation. Where a scale cannot clear AA, the code computes which of
   its slots may carry text rather than shipping the whole scale as type.
3. **A `<canvas>` is outside the cascade.** Charts cannot inherit CSS, so every chart
   colour is *read* from the live custom properties at runtime and converted for
   zrender. Hardcoding a hex in chart code silently decouples it from the site's
   configured brand and from dark mode.
4. **Bilingual by construction.** Client-rendered chart strings go through
   `iwac-i18n.js`; PHP-rendered strings go through Omeka's translator and the committed
   `language/fr.mo`. Parity and po→mo freshness are both build gates.
5. **Degraded mode is real.** Embed routes and third-party Omeka themes ship without
   the theme's CSS. Every consumed token carries a fallback equal to the theme's
   canonical light value, and the guard asserts that equality.

## What it is not

- Not a general-purpose BI tool: the blocks answer research questions about this
  corpus, in this corpus's vocabulary.
- Not a live query client: it does not hit the HF datasets-server from the browser for
  large subsets.
- Not a place to invent a second visual identity. Anything that looks like brand
  belongs upstream in the theme.
