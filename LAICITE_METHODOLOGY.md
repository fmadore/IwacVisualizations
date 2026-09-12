# Laïcité research instrument

The page supports source discovery and exploratory comparison. Vocabulary categories are not human-coded arguments, speakers or positions on laïcité.

## Population and text

The generator scans press articles, Islamic periodical issues, archival documents, YouTube audiovisual records (`source_type == youtube`) and scholarship. Dossier membership is the union of the curated Laïcité subject tag and a context-filtered core-vocabulary match. Tags and observed words remain distinct. Every source row, including negatives and rows without full text, contributes to coverage denominators.

Only titles and `OCR` (original full text or transcripts) contribute to vocabulary counts. AI descriptions, abstracts and tables of contents are excluded. The sensitivity diagnostic separately reports broad core candidates found only in legacy descriptive fields; these do not enter the dossier or lexical counts. It is not an exact reproduction of every older instrument version.

Categories may overlap: `école laïque` can contribute both core and education evidence. Summed category matches are therefore not unique spans. Token density divides by alphabetic tokens in exactly the fields searched. Repeated titles within OCR remain a possible source of repetition; the title/full-text controls expose this sensitivity. Tokenization and the lexicon are primarily designed for French and English, not every language in the archive.

French secular-state forms and English `secularism`, `secularization` and `secularisation` are included. Ambiguous *laïc* and *séculier* forms require positive contextual support. Layperson, clerical, vernacular-language and secular-arm senses are filtered; unresolved ties are omitted from the default count. The broad timeline and coverage diagnostic restore unfiltered candidates for inspection. This rule is not a measured accuracy guarantee.

## Measures and comparisons

| View | Unit and denominator |
|---|---|
| Coverage | Whole collection, by source type, optionally decade and country. Titles, full texts, public full texts and selected records are counted separately. All-country cells deduplicate multi-country records. |
| Timeline | One selected source type at a time; press full-text matching-document percentage is the default. Numerator: distinct records with a core match in the chosen field. Denominator: all records with that field available in the same year/country/outlet. Title/full-text union counts a document once. Raw matching documents and core occurrences are alternatives. Rates with fewer than five eligible records are omitted, as are missing years. |
| Seasons | Both calendars use the same records with Gregorian and stored Hijri months. Numerator: dossier records in each month; denominator: all records with both calendar values in that month and source type. Rates below five eligible records are omitted. Stored Umm al-Qura months are used, without browser recomputation. |
| Vocabulary contexts | Primary sources with a core match; a category must occur within 80 alphabetic tokens of a core match in the same field. Country–decade cells below five documents are omitted; all panels use a fixed 0–100% scale and show counts in tooltips. This reduces distant coincidences inside issues but is not article segmentation or argument coding. |
| Nearby words | Overall and within-language views compare core-term windows with the rest of those documents. Other facets compare one slice's windows with other slices' windows. Only core selection tokens are excluded automatically; annotation-category words are retained. G²/BH scoring and document-frequency filtering precede display truncation. Language comparisons group the full language label set so multilingual documents are not duplicated across single-language strata. |
| Implicit vocabulary | Tagged records without a retained core match versus records with core matches. Significance is evaluated before the display limit. Document spread is calculated over all significant candidates. The shared-vocabulary verdict is an explicit heuristic, not a validated conceptual classification. |
| Model sentiment | Full-corpus distributions remain descriptive benchmarks. A separate matched comparison uses non-dossier articles from the same country set, publication year and outlet. Each property has its own rated population; controls are weighted to matched dossier stratum sizes. Unmatched targets, controls and strata are reported. This is about model ratings of Islam/Muslims, not stance on laïcité. |
| Circulation | Embedding candidates across outlets; distinct item IDs are counted once per decade. Two public full texts receive word-sequence and five-word Jaccard comparisons plus opening excerpts. A withheld full text produces no excerpt or text-comparison detail. Similarity does not establish borrowing direction. |
| Bylines | Each byline's dossier count divided by all available press records carrying that byline. This is available archive output, not a complete career. Agency names remain bylines; multiple signatures can overlap. |

Scholarship is excluded from the primary-source aggregate chronology and appears only on explicit source selection. Its publication date is not the date of the period studied. YouTube publication/upload dates may differ from recording dates. Missing transcripts do not mean that a video lacks the topic. Maps describe catalogue geography, actors describe metadata mentions, and UMAP describes exploratory similarity rather than validated categories.

## Source checks and human validation

The Archives view includes editorial reading guides for items 76294 (the 1991 letter on unequal state-media treatment) and 11382 (the 2012 forum report). These are checked cases, not a representative validation sample. The concentration note calculates how much the largest archival document contributes to the archival occurrence total.

Generate a repeatable metadata-only coding worklist alongside the data:

```powershell
python scripts/generate_laicite.py --output-dir asset/data --validation-output .test-tmp/laicite-validation.json
```

Use `IWAC_DATASET_REVISION` to pin an immutable dataset SHA and the existing `HF_TOKEN` environment variable for authorized access. The sample draws up to ten records per source-type × language-label × decade × selection stratum, with a fixed random seed. Strata distinguish retained core matches, ambiguous candidates, tag-only records and apparent negatives. `population` and `sampled` preserve sampling fractions; raw full text is not exported into the worklist.

Two coders should independently assess whether the source contains a substantive religion–state claim, recording an evidence locator, claimant, addressee, issue, proposed state action and stance. Treat unavailable evidence as unassessable, not irrelevant. Record OCR quality in notes. Include cases without the literal vocabulary and do not infer a speaker's position from a journalist's prose. Reconcile disagreements only after preserving both original judgements.

Report precision and recall with the sampling design and target population stated; weight stratum estimates by their sampling fractions rather than pooling this deliberately balanced sample. A claim/stance timeline requires this substantive coding first. No human validation accuracy or inter-coder agreement is asserted by the implementation.

## Verification and publication

Regression tests cover field exclusion, rights gates, apostrophe offsets, overlapping categories, ambiguous senses, local context, proportional concordance sampling, negative-row denominators, matched controls and calendar eligibility. Browser tests cover bilingual controls, combined country/source filters, missing transcripts and mobile overflow. Full regenerated outputs are also checked against the pinned source data.

`laicite-research.json` carries aggregated coverage and sensitivity cells; the timeline includes these cells for its shared filter calculations. Generated JSON stays outside Git under `asset/data`; source code and compiled assets ship with the module. Regeneration and successful checks do not themselves publish a deployment or change Omeka tags.

### Verification run, 12 September 2026

At dataset revision `2b37e609bb26a15cc47026301b35d056e54ed382`, the v3 instrument selected 1,244 records (645 press, 406 periodicals, 5 archives, 188 scholarship, 0 YouTube) with 17,728 category matches. The YouTube population remains 1,743 records with 46 transcripts. A 706-record stratified worklist was generated; no human judgements were filled automatically.

The regenerated output passed 52 cross-bundle checks and 8,152 coverage/comparison checks. All 4,848 emitted concordance snippets were checked against their original fields, with no private OCR excerpts. The Python suite passed 116 tests, JavaScript passed 182, and the four focused bilingual Laïcité browser tests passed. The full browser run passed 56 of 57 initially; an unrelated 1800-pixel word-cloud clipping check failed by about one pixel and passed its isolated rerun. No word-cloud code was changed. Repository lint, separate Python Ruff checks and asset builds passed.
