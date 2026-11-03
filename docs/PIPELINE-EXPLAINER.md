# Pipeline Explainer

A page block that explains one IWAC processing workflow as a short animated
diagram, placed among the text of a page. It is educational: the drawings use
illustrative examples, the block requests no data and runs no model, and
viewing it needs no access to the private dataset.

## For editors

1. Edit the page (Admin → Sites → *site* → Pages), then **Add new block →
   Pipeline Explainer**.
2. **Workflow**: pick the preset.

   | Preset | Explains | Suggested page |
   |---|---|---|
   | Topic modelling (LDA) | articles → text preparation → word counts → LDA topics → topic mixtures | the topic-modelling methodology page, or beside a Topic Explorer block |
   | OCR with AI | two separate routes: direct extraction by a multimodal model, and post-correction of noisy OCR | *Optical character recognition* (`/page/ocr`) |
   | Entity extraction and metadata enrichment | extraction and normalisation → reconciliation → review → linking | *AI metadata enrichment* (`/page/ai-metadata-enrichment`) |
   | Albani Zaria sermons: from recordings to figures | recordings and transcripts → counting words → terms and neighbours → people and places → figures and passages | the Albani Zaria exhibition page, above or below its block |
   | Tables of contents for Islamic publications | issue → articles on each page → continuations → consolidation → table of contents | *AI metadata enrichment*, in its section on tables of contents (title heading level H3 under that section's H2) |
   | Ask AI: from a question to a cited answer | your question → tool calls → the dataset → results with their sources → the answer | *Ask AI* (`/page/ai-access`), after "What is an MCP connection?" |
   | Press attitudes: how language models rate the articles | articles → one task, several models → three ratings → justifications → comparison | *Press attitudes (AI)* (`/page/sentiment-analysis`), above the atlas |

3. **Title heading level**: one level below the heading of the section the
   block sits in (an H3 under an H2 section, the default). Routes, in the OCR
   preset, take the level below that.
4. Save. The block's text follows the site's language (English or French);
   there is nothing to translate per page.

Several Pipeline Explainers can sit on one page; each plays on its own. The
block cannot be embedded through the snippet gallery, because it needs its
two settings.

Putting the blocks on the published pages is a content step of its own, done
in the admin once the module release carrying the block is installed.

## What readers get

- **Without JavaScript, in print, and before the bundle arrives**: the whole
  explanation as text. A title, a lede, one numbered list of stages per route
  (each stage a name, a caption and sometimes a note), and a closing caveat on
  uncertainty and human review, with a line saying the examples are
  illustrative.
- **With JavaScript**: the same words with a drawing beside each stage. The
  sequence plays once, the first time the block scrolls into view (about four
  seconds), and again on **Replay animation**. It never loops, and it ends on
  the complete diagram.
- **Under `prefers-reduced-motion`**: the complete diagram, still, with no
  Replay control.
- **On a phone**: one stage a row, its drawing beside its words, in reading
  order. On a medium width, two stages a row.

The drawings are `aria-hidden`. Each stage's words say everything its drawing
shows, and every colour (topic, entity category) has its name beside it. The
drawings ink with the theme's tokens, so they follow the light/dark toggle
like the rest of the page.

## Where the words come from

All the text is in [`src/Site/PipelinePresets.php`](../src/Site/PipelinePresets.php),
each string marked `// @translate`, and translated in `language/fr.po` like
every other module string. The template renders the text reading from it, and
hands the same content, already translated, to the Svelte component as a JSON
island (`<script type="application/json">`, inert under any CSP). The
JavaScript carries drawings and behaviour only, and no dictionary.

The captions describe the pipelines as their code stands:

| Preset | Checked against |
|---|---|
| Topic modelling | IWAC-Hugging-Face: `lemmatize_update_hf.py` (spaCy `fr_core_news_lg` lemmas, stop words), `post-processing/lda_topic_modeling/` (gensim Phrases, `filter_extremes(no_below=10, no_above=0.4)`, `LdaModel`, k=30 for articles, top-3 mixture stored as `lda_topic_topk`) |
| OCR with AI | iwac-ai-pipelines: `AI_ocr_extraction/` (Gemini page by page or Mistral Document AI whole-PDF, the reading-order prompt, page markers, `iwac:ocrModel`, preview before write) and `AI_ocr_correction/` (raw OCR from `extracttext:extracted_text`, chunking at `--max-length`, corrected text to `bibo:content`, raw OCR kept) |
| Entity extraction | iwac-ai-pipelines: `AI_NER/` (persons, organisations, places, subjects; titles stripped; exact matches against titles and `dcterms:alternative`, ambiguous names set aside, fuzzy matches suggested only), `AI_authority_curation/`, `common/link_update_cli.py` (places → `dcterms:spatial`, the rest → `dcterms:subject`, add-only, backed up, `iwac:nerModel`) |
| Albani Zaria sermons | the exhibition's own method section (`asset/js/charts/albani-sermons/method.js`) and iwac-ai-pipelines `AI_audio_summary/` |
| Ask AI | iwac-mcp-server: the tool manifest (39 read-only tools, `readOnlyHint`), the handshake instructions and prompts (French search terms, cite the canonical URL), the dataset loader (public `fmadore/islam-west-africa-collection` by default; the Desktop extension caches ~265 MB locally), the provenance and coverage warnings every result carries |
| Press attitudes | iwac-ai-pipelines `AI_sentiment_analysis/` (`ANALYSABLE_LANGUAGES` French and English, whole OCR text one article at a time, the French prompt and its scales, "Non abordé" forcing polarity Non applicable and a null subjectivity, per-model `iwac:{stem}*` properties with justifications) and `scripts/generate_sentiment_atlas.py` (models kept apart, agreement measured, no majority label); the panel is `config/sentiment-models.json` `active`, so no caption names a model count |
| Tables of contents | iwac-ai-pipelines `AI_summary_issue/`: each page sent alone to a vision model (Gemini, Claude or Mistral OCR), `summary_prompt_issue.md` (title as printed with its section in brackets, authors, a 2–3-sentence summary, continuation markers, covers and advertisements set aside, Arabic terms kept), `consolidation_prompt_issue.md` (parts merged by title, markers and subject; pages and authors gathered; a 4–6-sentence summary), `03_update_omeka_toc.py` (`dcterms:tableOfContents` only, `iwac:summaryModel`, backup and confirmation) |

Two points differ from the original brief (issue #36). The NER pipeline uses
no OpenRefine: its review is the validation interface plus authority
curation. And it extracts no *events* category, so the entity preset shows
four categories. Change a caption when the pipeline changes, and check the
code rather than a summary of it.

## How it is built

| Piece | File |
|---|---|
| Block layout (form + render) | `src/Site/BlockLayout/PipelineExplainer.php` |
| Registry row (label, description, not embeddable) | `src/Site/BlockRegistry.php` |
| Template: text reading + JSON island | `view/common/block-layout/pipeline-explainer.phtml` |
| Orchestrator (classic script) | `asset/js/charts/pipeline-explainer.js` |
| Svelte entry and components | `asset/js/svelte/pipeline-explainer/` — `index.js`, `Explainer.svelte` (shell, play/Replay/reduced motion), one `*Art.svelte` per preset |
| Styles (both renderings, and the motion) | `asset/css/blocks/pipeline-explainer.css` |

`asset/js/bundles.json` names the block as `{ "svelte":
"svelte/pipeline-explainer/index.js", "files":
["charts/pipeline-explainer.js"] }`. `npm run build:js` compiles the
components with `svelte/compiler` and writes one bundle,
`asset/js/dist/blocks/pipeline-explainer.min.js` (the Svelte runtime
included, ~95 KB minified, ~33 KB gzipped), which the on-view loader fetches
only on a page with the block. ARCHITECTURE.md ("Build & development")
gives the rules the build enforces for Svelte components.

```bash
npm run build:js      # compile + bundle
npm run build:css     # minify the block sheet
npm run build         # lint, then both
```

## Adding or changing a preset

1. Add the preset to `PipelinePresets::PRESETS` (3–5 stages per route, each
   with an `art` id, `name`, `caption`, optional `note`; a `title` per route
   when there are several) and its admin label to `LABELS`.
2. Draw each `art` id in a new `asset/js/svelte/pipeline-explainer/<Name>Art.svelte`
   (`{#if kind === '…'}` branches) and register it in `Explainer.svelte`'s
   `ART` map. Use the shared mark classes in the block sheet. Put anything new
   in the sheet, not in the component.
3. Add the preset → component pair to the Pipeline explainer checks in
   `tests/php/run.php`. They fail on a stage nobody draws, a drawing no stage
   uses, or a string that bypasses `translate()`.
4. `node scripts/extract-pot.js`, add the French to `language/fr.po`,
   `npm run build:mo`.
5. Re-render the browser fixtures and run the spec:

   ```bash
   php tests/browser/render-pipeline-explainer.php en > tests/browser/fixtures/pipeline-explainer.en.html
   php tests/browser/render-pipeline-explainer.php fr > tests/browser/fixtures/pipeline-explainer.fr.html
   npx playwright test tests/browser/pipeline-explainer.spec.js
   ```

   `tests/php/run.php` fails while a fixture is stale. The spec covers the
   no-JavaScript reading, one mount per block, play once and Replay (keyboard
   included), reduced motion, the phone layout and overflow, the theme toggle,
   axe in both themes with the heading outline, and the French page.
