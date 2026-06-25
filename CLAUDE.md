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

**Design philosophy** (from theme v2.0.0): *research instrument, not editorial product.* Cool-leaning near-white surfaces (chroma ~0.002), cool-neutral inks, OKLCH-based palette, primary used **rarely** (focus / current-state / intentional accents only — never as decorative wash, never as gradient bar, never coloring h2s). No body atmospheric gradients. Visual neighborhood: MIT Press / Stripe Press / eLife / Linear docs — not a small museum's website. Read the theme's CLAUDE.md before doing any visual work.

**Token budget** — read these from the theme at runtime via `iwac-theme.js::readTokens()`; never hardcode equivalents:

- **Colors** — `--primary` (admin-overridable hex; do NOT redeclare), `--ink-strong`, `--ink`, `--ink-light`, `--ink-subtle`, `--muted`, `--surface`, `--surface-raised`, `--surface-sunken`, `--background`, `--border`, `--border-light`, `--border-strong`, `--focus-ring`. The theme owns dark/light derivations via Sass mixins; do not consume `--primary-hue` / `--primary-sat` (those HSL components were removed in v2.0.0 — derive variants from `--primary` via `color-mix(in oklab, ...)` instead).
- **Spacing** — `--space-{xs,sm,md,lg,xl,2xl,3xl}` (0.25 / 0.5 / 1 / 1.5 / 2 / 3 / 4 rem).
- **Radii** — `--radius-{sm,md,lg,xl,full}` (0.375 → 1 rem; `--radius-full = 9999px` for pills). Note: `--radius-md` was tightened from 12px → 8px in v2.0.0 for an institutional register.
- **Control sizing** — `--size-control-{xs,sm,md,lg,xl}` (28 → 48 px). `lg` (44px) is the WCAG tap target.
- **Measure** — `--measure-{narrow,base,wide}` (44 / 52.5 / 72.5 rem) for prose width caps.
- **Tracking** — `--tracking-tight` (display headings), `--tracking-wide` (small caps), `--tracking-wider` (eyebrow / metadata labels).
- **Fonts** — consume `--font-headings` / `--font-body` / `--font-mono` from the theme; do NOT hardcode Inter / Noto Serif. In CSS wrap as `var(--font-headings, "Noto Serif", …)` keeping the prior stack as fallback; in chart JS read `tokens.fontFamily` (from `iwac-theme.js::readTokens()`, which mirrors the body `font-family`).
- **Shadows** — `--shadow-{xs,sm,md,lg,xl}` (neutral cool, NOT warm-tinted). `--glow-*` ramp is primary-tinted, derived from `--primary` via `color-mix(in oklab, ...)`.
- **Accent line widths** — `--accent-line-sm` (2px), `--accent-line-md` (3px).
- **Color mixing** — always `color-mix(in oklab, ...)` (sRGB mixing produces muddy mid-tones). Use `--accent-mix-{subtle,medium,strong}` (25 / 40 / 60%) for standard primary tints rather than baking hex values.

**Theme switching:** the theme owns `body[data-theme="light|dark"]` and `localStorage['iwac-theme-preference']`. `dashboard-core.js` already wires a `MutationObserver` on `body[data-theme]` and rebuilds the ECharts theme + reinits every tracked chart on toggle. MapLibre instances `setStyle()` between Carto positron / dark-matter URLs. **Don't add a separate theme listener** in new panels — register charts via `IWACVis.registerChart()` and they auto-handle the swap.

**Visual conventions to match:**

- **Resource tag pills** — `border-radius: var(--radius-full)`, `text-transform: uppercase`, `letter-spacing: 0.06em`. The theme rule lives at `base/elements/_resource-tag.scss`; reuse the look on any chip / tag in chart UI.
- **Section headings** — `--tracking-tight` for display titles; small-caps + `--tracking-wide` for metadata labels. Default h2 color is `--ink-strong`, NOT `--primary` (theme v2.0.0 reserves brand color for state, not section markers).
- **Hover affordances** — fast purposeful transitions (150-200 ms). No bouncing / elastic curves. No card lift > 2px.
- **Focus** — visible focus rings via `--ring-focus`; never `outline: none` without a replacement.
- **Side-stripe borders** — `border-left/right` ≥ 2px is allowed ONLY for structural data-marker affordances (e.g. multi-color sentiment-card model indicator, compare-corpus A/B). Never as a decorative accent on cards or callouts.
- **AI-generated values** — when surfacing model output (sentiment scores, generated labels, summaries) give it explicit visual treatment (sparkle / badge / tinted block) so readers can distinguish computational artefacts from human-authored archival metadata. The theme's `.property--ai` block (resource-show) is the reference pattern.

**Block-CSS structure already in place:** `iwac-core.css` (tokens / panel / chip controls / table / form controls / section heading) → `iwac-maplibre.css` (only when the block uses a map) → `asset/css/blocks/<block>.css`. Add new block-local selectors to `blocks/<block>.css`; promote shared patterns into `iwac-core.css`. The README's "Build & development" section has the canonical breakdown.

**Verifying on the live site:** use Playwright MCP for visual debugging on `https://islam.zmo.de/s/westafrica/` (English) or `https://islam.zmo.de/s/afrique_ouest/` (French). Confirm chart colors pick up the live `--primary` and that the dark-mode toggle propagates into ECharts / MapLibre.

## Conventions specific to this module

- **Use `iwac_utils.py`** for country canonicalization, year extraction, pipe-separated parsing, coordinate parsing, dataset loading, and JSON saving. Do not reinvent these — see `scripts/README.md`. (`iwac_utils.py` was originally seeded from the now-**deprecated** sibling `iwac-dashboard` project, but is fully self-contained here: add and refactor shared helpers freely — there is **no** cross-repo sync constraint.)
- **CLI flags** are standardized across generators: `--repo`, `-v/--verbose`, `--minify` (heavy bundles), and `--min-cooccurrence` (TF-IDF networks default 2).
- **Output goes under `asset/data/`** as JSON (per-item fan-out `person-dashboards/{o_id}.json`, `entity-dashboards/{o_id}.json`, `article-dashboards/{o_id}.json`, etc.). Since **issue #7**, `asset/data/` is **gitignored**, **not committed**, and **not generated on the server**: the generators run in CI (`.github/workflows/regenerate-data.yml`) → publish `iwac-data.zip` to the `data` release → the admin **"Pull latest data"** job (`src/Job/SyncData.php`) unpacks it into `files/iwac-visualizations/`. The client fetches data from `files/`; static geojson lives committed in `asset/geo/`. The lone committed exception under `asset/data/` is `sentiment-arbiter.json` (externally sourced from the sibling IWAC-sentiment-analysis study, not HF). Use `--minify` on bundles > a few KB.
- **No module version bump needed for a data refresh.** The data cache-buster is the Sync Data job's last-sync time (stamped on each block as `data-version`, folded into `?v=` by `dashboard-core.js`). Only bump `config/module.ini` (+ `package.json`) for **code/asset** changes — that still busts the CSS/JS `?v=`.
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
2. Model a new generator on the existing `scripts/generate_*.py`. (The `iwac-dashboard` project these were originally seeded from is deprecated — don't depend on it.)
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
