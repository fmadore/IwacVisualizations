# CLAUDE.md — IwacVisualizations

Guidance for Claude Code when working in this repository.

## What this module is

Omeka S module that adds interactive visualizations to the [Islam West Africa Collection](https://islam.zmo.de/) at ZMO. Charts via [ECharts 6](https://echarts.apache.org/) + [MapLibre GL](https://maplibre.org/). Data is either fetched live from the public HF dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/`.

For the architectural overview — block layouts, asset partial, data strategy, theming, i18n, mobile UX — read [README.md](README.md) first. For the dataset shape consumed by the precompute scripts, see [DATA_NOTES.md](DATA_NOTES.md).

## Always use the `iwac-dataset` skill

When writing or modifying any Python that reads the HF dataset (anything under `scripts/generate_*.py`, anything that calls `load_dataset("fmadore/islam-west-africa-collection", …)`, or any new generator added next to them), invoke the **`iwac-dataset` skill** before touching code. It carries:

- Verified per-subset schema (field names, types, `embedding_OCR` vs `embedding_tableOfContents`, the three-model AI sentiment shape, `lda_topic_*` columns, etc.)
- Conventions: pipe-separated multi-values, ISO dates, `lda_topic_id == -1` outliers, country canonicalization
- Authority-record join pattern (`articles.subject` ↔ `index.Titre`)
- Place geocoding via `index.Coordonnées`
- Established TF-IDF entity co-occurrence formula and semantic kNN recipes
- Omeka resource templates ↔ resource classes table (e.g. `articles` and `publications` both use template 8 — distinguished by class 36 vs 60)

The skill catches the kind of subtle mistakes that have already cost real time here (e.g. the `embedding_descriptionAI` field that doesn't exist; `articles.lda_topic_id` is `float64`, not int; `articles.subject` strings are tag-membership matches, not substring matches).

## Match the IWAC theme — design integration

This module is built to drop into the **[IWAC theme](https://github.com/fmadore/IWAC-theme)**. Every visual choice here must compose with the theme rather than fight it.

**Design philosophy** (from the theme's CLAUDE.md): *modern, professional, academic — warm and inviting without being flashy.* This is a **newspaper collection**, so the aesthetic is editorial / journalistic, not archival or antiquarian. Light theme uses **warm neutral tones** (hue ~35-40, subtle cream undertones), the IWAC primary orange is an **accent — not dominant**, and shadows are warm-tinted (avoid harsh black). Read the theme's CLAUDE.md before doing any visual work.

**Token budget** — read these from the theme at runtime via `iwac-theme.js::readTokens()`; never hardcode equivalents:

- **Colors** — `--primary`, `--ink`, `--ink-light`, `--muted`, `--surface`, `--surface-raised`, `--background`, `--border`, `--border-light`, `--focus-ring`. Both light and dark modes are auto-derived from `--primary-hue` / `--primary-sat`.
- **Spacing** — `--space-{xs,sm,md,lg,xl}` (0.25 / 0.5 / 1 / 1.5 / 2 rem).
- **Radii** — `--radius-{sm,md,lg,xl,full}` (0.375 → 1.5 rem; `--radius-full = 9999px` for pills).
- **Control sizing** — `--size-control-{xs,sm,md,lg,xl}` (28 → 48 px). `lg` (44px) is the WCAG tap target.
- **Measure** — `--measure-{narrow,base,wide}` for prose width caps.
- **Tracking** — `--tracking-tight` (display headings), `--tracking-wide` (small caps), `--tracking-wider` (eyebrow / metadata labels).
- **Shadows** — `--shadow-{xs,sm,md,lg}` and the `--glow-*` ramp (warm, primary-tinted).
- **Accent line widths** — `--accent-line-sm` (2px), `--accent-line-md` (3px).
- **Color mixing** — use `--accent-mix-{subtle,medium,strong}` (25 / 40 / 60%) with `color-mix()` rather than baking hex values.

**Theme switching:** the theme owns `body[data-theme="light|dark"]` and `localStorage['iwac-theme-preference']`. `dashboard-core.js` already wires a `MutationObserver` on `body[data-theme]` and rebuilds the ECharts theme + reinits every tracked chart on toggle. MapLibre instances `setStyle()` between Carto positron / dark-matter URLs. **Don't add a separate theme listener** in new panels — register charts via `IWACVis.registerChart()` and they auto-handle the swap.

**Visual conventions to match:**

- **Resource tag pills** — `border-radius: var(--radius-full)`, `text-transform: uppercase`, `letter-spacing: 0.06em`. The theme rule lives at `base/elements/_resource-tag.scss`; reuse the look on any chip / tag in chart UI.
- **Section headings** — `--tracking-tight` for display titles; small-caps + `--tracking-wide` for metadata labels.
- **Hover affordances** — fast purposeful transitions (150-200 ms). No bouncing / elastic curves.
- **Focus** — visible focus rings via `--ring-focus`; never `outline: none` without a replacement.

**Block-CSS structure already in place:** `iwac-core.css` (tokens / panel / chip controls / table / form controls / section heading) → `iwac-maplibre.css` (only when the block uses a map) → `asset/css/blocks/<block>.css`. Add new block-local selectors to `blocks/<block>.css`; promote shared patterns into `iwac-core.css`. The README's "Build & development" section has the canonical breakdown.

**Verifying on the live site:** use Playwright MCP for visual debugging on `https://islam.zmo.de/s/westafrica/` (English) or `https://islam.zmo.de/s/afrique_ouest/` (French). Confirm chart colors pick up the live `--primary` and that the dark-mode toggle propagates into ECharts / MapLibre.

## Conventions specific to this module

- **Use `iwac_utils.py`** for country canonicalization, year extraction, pipe-separated parsing, coordinate parsing, dataset loading, and JSON saving. Do not reinvent these — see `scripts/README.md`. The helpers are ported from the sibling `iwac-dashboard` project; consult that project's `scripts/` before writing a brand-new generator.
- **CLI flags** are standardized across generators: `--repo`, `-v/--verbose`, `--minify` (heavy bundles), and `--min-cooccurrence` (TF-IDF networks default 2).
- **Output goes under `asset/data/`** as JSON. Per-item fan-out (`person-dashboards/{o_id}.json`, `entity-dashboards/{o_id}.json`, `article-dashboards/{o_id}.json`) is committed to git; collection-level bundles too. Use `--minify` on bundles > a few KB.
- **Bump `config/module.ini` `version`** after any data regeneration so Omeka's `?v=` query string busts the browser cache. Match in `package.json`.
- **JS sources mirror to `.min.js`** via `npm run build:js` (terser). Both source and `.min.js` are committed.
- **Template references `.min.js` paths only.** When adding a new block, declare needs through `view/common/iwac-assets.phtml` — do not write raw `headScript`/`headLink` in templates.

## Python environment

Use a Python that has `pyarrow` installed for parquet / `datasets` work. Standard local setup:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
```

CPU-only environment (no GPU) — match the constraint when selecting models or batch sizes.

## Adding a new visualization

1. Reach for the `iwac-dataset` skill to confirm field names and types.
2. Check `iwac-dashboard` for an existing generator before writing one.
3. Decide live-fetch vs. precompute using the rule in README.md (precompute if > 50 parallel HF requests OR touches OCR/embeddings).
4. Write `scripts/generate_<name>.py` following the existing CLI convention; reuse `iwac_utils.py`.
5. Wire the JS panel and orchestrator under `asset/js/charts/` and the template under `view/common/block-layout/`.
6. Add the partial-driven asset declaration (don't enqueue manually).
7. Bump `config/module.ini` version; run `npm run build:js`; commit both source and minified JS.

## What not to do

- Don't add controller-level asset listeners that load ECharts/MapLibre on every page (see `Module.php` docblock — that cost 600 KB of unused JS site-wide).
- Don't hardcode hex colors in chart code — read CSS custom properties through `iwac-theme.js` so the IWAC theme's `--primary` flows through.
- Don't query the HF `datasets-server` directly from JS for large subsets; use the precompute path and a single `fetch()` of a generated JSON instead.
- Don't filter the IWAC corpus on Islamic-domain stopwords (COSIM, FAIB, UIB, Ramadan, Tabaski, Maouloud, etc.) — those are core research terms, not noise.
