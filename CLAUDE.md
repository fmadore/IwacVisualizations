# CLAUDE.md — IwacVisualizations

Guidance for Claude Code when working in this repository.

## What this module is

Omeka S module that adds interactive visualizations to the [Islam West Africa Collection](https://islam.zmo.de/) at ZMO. Charts via [ECharts 6](https://echarts.apache.org/) + [MapLibre GL](https://maplibre.org/). Data is either fetched live from the public HF dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/`. **The precompute scripts read the private full mirror `fmadore/islam-west-africa-collection-full`** (`iwac_utils.DATASET_ID`) and require an `HF_TOKEN`; in CI it comes from the repo secret.

For the architectural overview — block layouts, asset partial, data strategy, theming, i18n, mobile UX — read [README.md](README.md) first. For the dataset shape consumed by the precompute scripts, see [DATA_NOTES.md](DATA_NOTES.md).

## Always use the `iwac-dataset` skill

When writing or modifying any Python that reads the HF dataset (anything under `scripts/generate_*.py`, anything that calls `load_dataset(…)` on the IWAC dataset or its `-full` mirror, or any new generator added next to them), invoke the **`iwac-dataset` skill** before touching code. It carries:

- Verified per-subset schema (field names, types, `embedding_OCR` vs `embedding_tableOfContents`, the multi-model AI sentiment shape, `lda_topic_*` columns, etc.)
- Conventions: pipe-separated multi-values, ISO dates, `lda_topic_id == -1` outliers, country canonicalization
- Authority-record join pattern (`articles.subject` ↔ `index.Titre`)
- Place geocoding via `index.Coordonnées`
- Established TF-IDF entity co-occurrence formula and semantic kNN recipes
- Omeka resource templates ↔ resource classes table (e.g. `articles` and `publications` both use template 8 — distinguished by class 36 vs 60)

The skill catches the kind of subtle mistakes that have already cost real time here (e.g. the `embedding_descriptionAI` field that doesn't exist; `articles.lda_topic_id` is `float64`, not int; `articles.subject` strings are tag-membership matches, not substring matches).

## Match the IWAC theme — design integration

This module drops into the **[IWAC theme](https://github.com/fmadore/IWAC-theme)**, which owns the visual stance and every design token. **Read the stance there, and restate none of it here:**

- [`docs/DESIGN-PHILOSOPHY.md`](https://github.com/fmadore/IWAC-theme/blob/master/docs/DESIGN-PHILOSOPHY.md) — the register, the core principles, what to avoid.
- [`docs/DESIGN-SYSTEM.md`](https://github.com/fmadore/IWAC-theme/blob/master/docs/DESIGN-SYSTEM.md) — the token contract: what may be consumed, the fallback rule, the sanctioned module-owned namespace, the breakpoints.
- `tokens.json` (synced into this repo) — the machine-readable truth. It wins over any prose, anywhere, including this file. `npm run lint:theme` enforces it.

> This section used to carry its own copy of the philosophy and a hand-maintained token budget. Both went stale exactly the way copies do. It quoted the **v2.0.0** stance ("visual neighbourhood: MIT Press / Stripe Press / eLife / Linear docs") a full redesign after the theme moved to the press-archive register — while the June 2026 rebuild of *this module's own blocks* to that register was already shipped. It told authors to keep `"Noto Serif"` as the `--font-headings` fallback, a family the design system lists as removed. It named `--tracking-tight` for display headings, when v2.6 added `--tracking-display` precisely because slab serifs clog at the tighter value. And it stated that `--focus-ring` / `--ring-focus` "do NOT exist — phantom names from older docs", when both are defined in the theme, published in `tokens.json`, and listed as consumable — so anyone following it was steered off two real tokens and onto a literal, which is how one focus declaration came to be hand-copied 44 times across these stylesheets. The code was on v2.6 and the instructions for changing it were on v2.0.0.

### Module-specific gotchas

These are the things the shared docs can't tell you, because they are about *this* module.

- **Charts can't inherit CSS.** A `<canvas>` is outside the cascade, so `iwac-theme.js::readTokens()` reads tokens at runtime via `getComputedStyle` and converts modern colour syntax to legacy `rgb()` for zrender. Add new token-driven chart colours by reading them there — never by hardcoding.
- **Theme switching is already wired.** `dashboard-core.js` observes `body[data-theme]` and rebuilds the ECharts theme + reinits every tracked chart; MapLibre `setStyle()`s between Carto positron / dark-matter. **Don't add a separate theme listener** — register charts via `IWACVis.registerChart()`.
- **Focus is one token now.** `outline: var(--focus-outline, 2px solid #ce4115)`. Reach for `--ring-focus` (box-shadow) only where an outline would be clipped — inside `overflow: hidden` or a scroll container. Never `outline: none` without a replacement.
- **Side-stripe borders** — `border-left/right` ≥ 2px is allowed ONLY for structural data-marker affordances (multi-colour sentiment-card model indicator, compare-corpus A/B). Never as a decorative accent on cards or callouts; the philosophy bans them generally.
- **AI-generated values** get explicit visual treatment (badge / tinted block) so readers can tell computational artefacts from human-authored archival metadata. The theme's `.property--ai` block is the reference pattern.
- **The module namespace is `--iwac-vis-`, and only that.** It is for values the theme should not carry — data-encoding colours (§4 of DESIGN-SYSTEM.md) and module-local layout constants with no theme equivalent. It is **not** a place to re-declare a theme token: `--iwac-vis-icon-btn-sm: 28px` was `--size-control-xs` to the pixel, and the shadow tints re-derived from `--ink` what `--shadow-color*` already publishes. Both are gone. `lint:theme` only exempts the full `--iwac-vis-` prefix, so a shortened one (`--iwac-otd-…`) now fails.
- **Model accents are role slots**, `--iwac-vis-model-1..4`, not model ids. The id → slot map lives in `MODEL_SLOT` (charts/sentiment-atlas.js) and nowhere else. Upgrading a model is one line there; it must never rename a token.
- **CSS is hand-edited, then minified.** `npm run build:css` (csso) writes the `*.min.css` templates actually load. Edit the source, never the `.min`.

**Block-CSS structure already in place:** `iwac-core.css` (tokens / panel / chip controls / table / form controls / section heading) → `iwac-maplibre.css` (only when the block uses a map) → `asset/css/blocks/<block>.css`. Add new block-local selectors to `blocks/<block>.css`; promote shared patterns into `iwac-core.css`. The README's "Build & development" section has the canonical breakdown.

**Verifying on the live site:** use Playwright MCP for visual debugging on `https://islam.zmo.de/s/westafrica/` (English) or `https://islam.zmo.de/s/afrique_ouest/` (French). Confirm chart colors pick up the live `--primary` and that the dark-mode toggle propagates into ECharts / MapLibre.

## Conventions specific to this module

- **Use `iwac_utils.py`** for country canonicalization, year extraction, pipe-separated parsing, coordinate parsing, dataset loading, and JSON saving. Do not reinvent these — see `scripts/README.md`. (`iwac_utils.py` was originally seeded from the now-**deprecated** sibling `iwac-dashboard` project, but is fully self-contained here: add and refactor shared helpers freely — there is **no** cross-repo sync constraint.)
- **CLI flags** are standardized across generators: `--repo`, `-v/--verbose`, `--minify` (heavy bundles), and `--min-cooccurrence` (TF-IDF networks default 2).
- **Output goes under `asset/data/`** as JSON (per-item fan-out `person-dashboards/{o_id}.json`, `entity-dashboards/{o_id}.json`, `article-dashboards/{o_id}.json`, etc.). Since **issue #7**, `asset/data/` is **gitignored**, **not committed**, and **not generated on the server**: the generators run in CI (`.github/workflows/regenerate-data.yml`) → publish `iwac-data.zip` to the `data` release → the admin **"Pull latest data"** job (`src/Job/SyncData.php`) unpacks it into `files/iwac-visualizations/`. The client fetches data from `files/`; static geojson lives committed in `asset/geo/`. The committed exceptions under `asset/data/` are the two hand-curated event sidecars, `scary-terms-events.json` and `laicite-events.json`. Use `--minify` on bundles > a few KB.
- **No module version bump needed for a data refresh.** The data cache-buster is the Sync Data job's last-sync time (stamped on each block as `data-version`, folded into `?v=` by `dashboard-core.js`). Only bump `config/module.ini` (+ `package.json`) for **code/asset** changes — that still busts the CSS/JS `?v=`.
- **JS sources mirror to `.min.js`** via `npm run build:js` (terser). Both source and `.min.js` are committed.
- **Template references `.min.js` paths only.** When adding a new block, declare needs through `view/common/iwac-assets.phtml` — do not write raw `headScript`/`headLink` in templates. `blockCss` accepts a list when a block layers its own sheet over a shared base.
- **A block is declared once**, in `src/Site/BlockRegistry.php`; `npm run lint:blocks` fails the build if the registry, the config invokables, the `BlockLayout` classes and the templates stop agreeing. (v1.21 shipped a block whose embed slug didn't match its template filename, 500ing every embed of it — that class of drift is now a build failure.)

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
5. Register the block in `src/Site/BlockRegistry.php` (slug, label, description, `embeddable`) — that is the single source of truth for the label, the admin description, the partial name, the embed slug and the embed whitelist. Add a `BlockLayout` subclass whose whole body is `const SLUG = '<slug>';`, and the invokable in `config/module.config.php`.
6. Wire the JS panel and orchestrator under `asset/js/charts/` and the template under `view/common/block-layout/<slug>.phtml` — the filename must equal the slug (the embed route resolves the partial by slug). End the orchestrator with a single `P.bootBlock({...})` call rather than a hand-rolled DOMContentLoaded/fetch/catch epilogue.
7. Add the partial-driven asset declaration (don't enqueue manually) — the template calls `common/iwac-block-shell` with an `assets` array.
8. Bump `config/module.ini` version (+ `package.json`); run `npm run build` — it runs `lint:theme` (theme tokens, now including `<style>` blocks in `view/`) and `lint:blocks` (registry ↔ config ↔ classes ↔ templates agree) before minifying. Commit both source and minified assets.

## What not to do

- Don't add controller-level asset listeners that load ECharts/MapLibre on every page (see `Module.php` docblock — that cost 600 KB of unused JS site-wide).
- Don't hardcode hex colors in chart code — read CSS custom properties through `iwac-theme.js` so the IWAC theme's `--primary` flows through.
- Don't query the HF `datasets-server` directly from JS for large subsets; use the precompute path and a single `fetch()` of a generated JSON instead.
- Don't filter the IWAC corpus on Islamic-domain stopwords (COSIM, FAIB, UIB, Ramadan, Tabaski, Maouloud, etc.) — those are core research terms, not noise.
