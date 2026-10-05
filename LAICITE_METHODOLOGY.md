# Laïcité research instrument

The page supports source discovery and exploratory comparison. Vocabulary categories are not human-coded arguments, speakers or positions on laïcité.

## Population and text

The generator scans press articles, Islamic periodical issues, archival documents, YouTube audiovisual records (`source_type == youtube`) and scholarship. Dossier membership is the union of the curated Laïcité subject tag and a context-filtered core-vocabulary match. Tags and observed words remain distinct. Every member also carries the route that admitted it, as a displayed attribute rather than a filter; see *Membership strength* below. Every source row, including negatives and rows without full text, contributes to coverage denominators.

Only titles and `OCR` (original full text or transcripts) contribute to vocabulary counts. AI descriptions, abstracts and tables of contents are excluded. The sensitivity diagnostic separately reports broad core candidates found only in legacy descriptive fields; these do not enter the dossier or lexical counts. It is not an exact reproduction of every older instrument version.

Categories may overlap: `école laïque` can contribute both core and education evidence. Summed category matches are therefore not unique spans. Token density divides by alphabetic tokens in exactly the fields searched. Repeated titles within OCR remain a possible source of repetition; the title/full-text controls expose this sensitivity. Tokenization and the lexicon are primarily designed for French and English, not every language in the archive.

French secular-state forms and English `secularism`, `secularization` and `secularisation` are included. Ambiguous *laïc* and *séculier* forms require positive contextual support. Layperson, clerical, vernacular-language and secular-arm senses are filtered; unresolved ties are omitted from the default count. The broad timeline and coverage diagnostic restore unfiltered candidates for inspection. This rule is not a measured accuracy guarantee.

## Membership strength

One core match admits a record, and one match is often incidental — a job title, a school type, a set phrase, a cited book title. Membership is therefore not tightened; the evidence behind it is exposed. Each member is labelled with exactly one of four routes: `tag+text` (the curated tag and at least one core match), `text>=2` (no tag, two or more core matches), `text=1` (no tag, a single core match) and `tag-only` (the curated tag, no retained core match). Two further flags travel with the item: a core match in the *title*, and, for scholarship only, a *bibliography-only* match.

The routes are ordered by measured relevance, not by assumption; the September 2026 screen below reports the share judged substantive on each. Tightening membership was tested and rejected: requiring two matches or a title hit would have removed 207 relevant single-match members to drop 59 false ones, and the `tag-only` stratum is where the curator's broader religion–state concept exceeds the lexical one rather than where the instrument is wrong.

A title hit is the strongest single signal observed: every text-only member with a core term in its title was read as substantive (24 of 24). The bibliography-only signal addresses a different failure: scholarship cites scholarship, so a work can match the core vocabulary only inside its own reference list. It is computed on folded OCR, for `references` only, and only for text-only members without a title hit and without the curated tag. Either a bibliography heading (`bibliographie`, `references`, `works cited` and similar, once numbering and decorative punctuation are stripped) occurring past 60% of the text marks the start of the end matter and every core match falls after it; or, when OCR has lost the line breaks, every core match sits in the final 20% of the text with a citation cue — a four-digit year, a `pp. 12` page marker, or a page range — within ±60 characters. It flagged 6 works, all 6 of which the screen judged not relevant, catching 6 of the 34 false scholarly members at no cost in false alarms on this population.

The concordance and the bibliography view render these as badges (*single mention*, *bibliography only*) and offer a strict filter that hides records admitted on a single core match, and scholarship whose only matches sit in a reference list; tagged records and records with two or more matches stay. The filter is a reading aid over the same data, never a change to what the counts elsewhere include.

## Family-law vocabulary

The `droit-famille` annotation frame was revised on 14 September 2026 after the screen measured its forms one by one. Bare `héritage` (and, through accent folding, `heritage`) was retired: it carried the frame's legal sense in 38% of its 487 occurrences, the rest being colonial and political legacy, a hadith on the prophets' inheritance, and a newspaper named *L'Héritage*. No context window rescued it — the best of ten tested gates reached 70% precision at 40% recall, because the true and false uses share the same syntax. The word now follows the rule `succession` already followed: explicit legal phrases only (`part(s) d'héritage`, `droit(s) à l'héritage`, `droit(s) d'héritage`, `partage de l'héritage`, `loi sur l'héritage`, `héritage en islam`). Recall on genuine inheritance-law passages falls substantially in exchange; the bare word carried 186 true hits.

`divorce` gained the lexicon's first per-form negative right context: it is not counted when immediately followed by *entre* or *avec*, the metaphorical political or institutional divorce. Measured on the labelled rows, the exclusion raises precision from 92.4% to 97.1% while retaining 99.3% of the true hits. The mechanism is a `not_followed_by` block in the frame's sidecar, compiled into the frame pattern as a negative lookahead over folded text; it is for a form whose false uses are marked by what follows them, and a form whose two senses share their neighbours still belongs in `ambiguous` or in explicit phrases only.

## Model-assisted screen

On 14 September 2026, 69 Claude Sonnet readers judged the dossier against two written rule sheets, each reading one batch from the private full text without access to other batches or to the generator. Tier 1 covered 3,115 annotation-frame occurrences — every `droit-famille` occurrence in a member, plus every other frame occurrence within 80 tokens of a core hit, which are the only ones the arenas view counts — asking whether the matched form carries the frame's sense and whether the passage concerns religion and the state. Tier 2 covered all 1,244 members, asking whether the record contains a substantive laïcité, secular-state or religion–state passage. The rule sheets are committed as `scripts/laicite/audit/INSTRUCTIONS-tier1.md` and `INSTRUCTIONS-tier2.md` and hashed into every verdict.

**This is one model's reading under a written rule. It is not human validation, and no accuracy is asserted for it.** It is triage: a way of seeing which parts of the instrument carry weak evidence, and where to look first. The two-coder design in *Source checks and human validation* remains the validation path.

Annotation frames were clean apart from family law: across the 1,738 near-core occurrences of the seven other frames, 97.9% were judged correct on both criteria, with at most one false row each for `separation`, `liberte-religieuse`, `etat-rites` and `concurrence`. The residual `ecole` errors are biographical mentions and survey checkboxes rather than wrong senses.

Membership was judged substantive for 1,081 of 1,244 members, 86.9% overall, and the figure is route-dependent:

| Route | Screened | Read as substantive | Share |
|---|---:|---:|---:|
| Tag and vocabulary | 688 | 671 | 97.5% |
| Vocabulary, two or more mentions | 193 | 175 | 90.7% |
| Vocabulary, one mention | 283 | 209 | 73.9% |
| Catalogue tag only | 80 | 26 | 32.5% |

The tag-only share is not an error rate, and reading it as one would invert the finding. **The curated tag and the core vocabulary measure different concepts.** The readers applied a narrow rule — a passage must invoke laïcité or the secular state — while the tag encodes religion–state relations more broadly: state food aid to Muslim communities for Ramadan, a prefect restricting a prayer gathering, municipal rules on street prayer, an Islamic federation against the family code, politicians courting religious constituencies. Those records are about the relationship between religion and the state without ever using the word, and they are exactly the population the implicit-vocabulary view exists to surface. A disagreement between tag and lexicon is a finding to read, not an error to correct.

The verdicts are kept, so the screen is incremental. `scripts/laicite/audit_ledger.json` is committed and currently holds 1,244 member verdicts and 3,057 occurrence verdicts, all from model `claude-sonnet-5` under rule hashes `53995dd4b8` (tier 1) and `daf5e44a10` (tier 2). The October 2026 rule sheets differ from those only in what a reader must copy back (below), so their hashes differ and the next merge registers them beside the old ones. It stores identifiers, verdicts, the date, the model and the rule hash — **no source text and no reader notes**, which can quote private OCR and stay under the gitignored `.test-tmp`, along with the batches and the raw verdict files. The workflow is three subcommands:

```powershell
python scripts/audit_laicite.py extract --work-dir .test-tmp/laicite-audit
python scripts/audit_laicite.py merge --work-dir .test-tmp/laicite-audit --model <id>
python scripts/audit_laicite.py status
```

`extract` writes batches only for members and occurrences the ledger does not already cover, so a re-run after new records are ingested judges the new material and not the 1,244 already read. A tier-1 row is keyed by a fingerprint of the folded text ±60 characters around the match, so a verdict survives a re-scan that shifts offsets and is invalidated only when the passage itself changes; a tier-2 record carries a fingerprint of its core-hit forms, so a record whose hits changed since it was judged is reported *stale* rather than silently reused. `merge` folds the verdict files in, `status` reports coverage, staleness and what remains unjudged.

Batch file names repeat from one extract to the next, so nothing is matched by name or position. Every extract is a run with its own identifier, stamped on the manifest and on every batch row; a reader copies the row's `run` — and, in tier 1, its fingerprint `fp` — into each verdict, and `merge` refuses a verdict whose run differs from the batch's or whose fingerprint matches no row. A tier-1 verdict is stored under the fingerprint it echoes, and `sense_ok` and `religion_state` must be booleans, as tier 2's `relevant` must be one of its three values. `extract` refuses to start while the verdicts directory still holds files from an earlier run (`--archive-previous` moves that run's batches, verdicts and manifest under `archive/<run>/` once it has been merged), and `merge` is all or nothing: with any problem it reports every one and leaves the ledger untouched.

The generator reads the ledger at build time and publishes only the aggregate, as `audit_screen` in `laicite-metadata.json`; the block renders that object and nothing else, so no percentage on the page is written into the interface. Verdicts are keyed by subset and item, so a member the lexicon no longer selects drops out of the denominator, and the route breakdown is read from the current scan rather than from the route stored beside the verdict — the published figures describe the dossier as it now stands.

## Measures and comparisons

| View | Unit and denominator |
|---|---|
| Coverage | Whole collection, by source type, optionally decade and country. Titles, full texts, public full texts and selected records are counted separately. All-country cells deduplicate multi-country records; a record naming no country appears only in the all-country cells. |
| Timeline | One selected source type at a time; press full-text matching-document percentage is the default. Numerator: distinct records with a core match in the chosen field. Denominator: all records with that field available in the same year/country/outlet. Title/full-text union counts a document once. Raw matching documents and core occurrences are alternatives. Rates with fewer than five eligible records are omitted, as are missing years. |
| Seasons | Both calendars use the same records with Gregorian and stored Hijri months. Numerator: dossier records in each month; denominator: all records with both calendar values in that month and source type. Rates below five eligible records are omitted. Stored Umm al-Qura months are used, without browser recomputation. |
| Vocabulary contexts | Primary sources with a core match; a category must start within 80 alphabetic tokens of the start of a retained core match in the same field (80 tokens exactly still counts). This view and the model-assisted screen read one proximity flag set during the scan, so they cannot disagree at the boundary. Country–decade cells below five documents are omitted; all panels use a fixed 0–100% scale and show counts in tooltips. This reduces distant coincidences inside issues but is not article segmentation or argument coding. |
| Nearby words | Overall and within-language views compare core-term windows with the rest of those documents. Other facets compare one slice's windows with other slices' windows. Only core selection tokens are excluded automatically; annotation-category words are retained. G²/BH scoring and document-frequency filtering precede display truncation. Within-language comparisons are keyed by single language: a multilingual document joins the comparison for each of its languages, each of which is scored on its own and never summed with another. Documents without a language label are in no within-language comparison, and a language with nothing that clears the floors is omitted rather than shown empty. |
| Implicit vocabulary | Tagged records without a retained core match versus records with core matches. Significance is evaluated before the display limit. Document spread is calculated over all significant candidates. The shared-vocabulary verdict is an explicit heuristic, not a validated conceptual classification. |
| Model sentiment | Full-corpus distributions remain descriptive benchmarks. A separate matched comparison uses non-dossier articles from the same country set, publication year and outlet; an article naming no country, year or outlet is never matched. Each property has its own rated population; controls are weighted to matched dossier stratum sizes. Unmatched targets, controls and strata are reported. This is about model ratings of Islam/Muslims, not stance on laïcité. |
| Circulation | Embedding candidates across outlets; distinct item IDs are counted once per decade. Two public full texts receive word-sequence and five-word Jaccard comparisons plus opening excerpts. A withheld full text produces no excerpt or text-comparison detail. Similarity does not establish borrowing direction. |
| Bylines | Each byline's dossier count divided by all available press records carrying that byline. This is available archive output, not a complete career. Agency names remain bylines; multiple signatures can overlap. |

Scholarship is excluded from the primary-source aggregate chronology and appears only on explicit source selection. Its publication date is not the date of the period studied. YouTube publication/upload dates may differ from recording dates. Missing transcripts do not mean that a video lacks the topic. Maps describe catalogue geography, actors describe metadata mentions, and UMAP describes exploratory similarity rather than validated categories.

## Source checks and human validation

The Archives view includes editorial reading guides for items 76294 (the 1991 letter on unequal state-media treatment) and 11382 (the 2012 forum report). These are checked cases, not a representative validation sample. The concentration note calculates how much the largest archival document contributes to the archival occurrence total.

Generate a repeatable metadata-only coding worklist alongside the data:

```powershell
python scripts/generate_laicite.py --output-dir asset/data --validation-output .test-tmp/laicite-validation.json
```

Use `IWAC_DATASET_REVISION` to pin an immutable dataset SHA and the existing `HF_TOKEN` environment variable for authorized access. The sample draws up to ten records per source-type × language-label × decade × selection stratum, with a fixed random seed. Strata distinguish retained core matches, ambiguous candidates, tag-only records and apparent negatives. Each sampled row also carries its membership `route`, so coding can be read back route by route. `population` and `sampled` preserve sampling fractions; raw full text is not exported into the worklist.

Two coders should independently assess whether the source contains a substantive religion–state claim, recording an evidence locator, claimant, addressee, issue, proposed state action and stance. Treat unavailable evidence as unassessable, not irrelevant. Record OCR quality in notes. Include cases without the literal vocabulary and do not infer a speaker's position from a journalist's prose. Reconcile disagreements only after preserving both original judgements.

Report precision and recall with the sampling design and target population stated; weight stratum estimates by their sampling fractions rather than pooling this deliberately balanced sample. A claim/stance timeline requires this substantive coding first. No human validation accuracy or inter-coder agreement is asserted by the implementation.

The model-assisted screen does not replace any part of this design. It is triage ahead of it: the 706-record worklist is still the sample to code, and the screen's flagged rows — every non-clean verdict with the reader's note, written under `.test-tmp` and never committed — are a list of places to look, nothing more.

## Verification and publication

Regression tests cover field exclusion, rights gates, apostrophe offsets, overlapping categories, ambiguous senses, local context and its 80-token boundary, proportional concordance sampling across a subset and every-frame-first sampling within an item, negative-row denominators, country-less records in the matched comparison, the merge's run and fingerprint checks, matched controls and calendar eligibility. Browser tests cover bilingual controls, combined country/source filters, missing transcripts and mobile overflow. Full regenerated outputs are also checked against the pinned source data.

The aggregated coverage and sensitivity cells ship inside `laicite-trends.json` under `research`, together with their rate floor (`minimum_cell`, five eligible records); the timeline is drawn from those cells alone, so the bundle carries nothing else, and there is no separate research file. The per-year frame series and the per-country aggregate bundle (`laicite-countries.json`) that preceded the cells are no longer generated. The seasonality bundle states the same floor. The bundles cite the instrument as `method_version` `source-text-v4` since October 2026: one parse of each record's metadata shared by the dossier and the coverage cells (no `Unknown` country cells; articles naming no country are never matched), the rights flag read so that a missing value withholds text, single-language collocate comparisons and every-category-first concordance sampling within an item. The verification runs below were made with v3. Generated JSON stays outside Git under `asset/data`; source code and compiled assets ship with the module. Regeneration and successful checks do not themselves publish a deployment or change Omeka tags.

### Verification run, 12 September 2026

At dataset revision `2b37e609bb26a15cc47026301b35d056e54ed382`, the v3 instrument selected 1,244 records (645 press, 406 periodicals, 5 archives, 188 scholarship, 0 YouTube) with 17,728 category matches. The YouTube population remains 1,743 records with 46 transcripts. A 706-record stratified worklist was generated; no human judgements were filled automatically.

The regenerated output passed 52 cross-bundle checks and 8,152 coverage/comparison checks. All 4,848 emitted concordance snippets were checked against their original fields, with no private OCR excerpts. The Python suite passed 116 tests, JavaScript passed 182, and the four focused bilingual Laïcité browser tests passed. The full browser run passed 56 of 57 initially; an unrelated 1800-pixel word-cloud clipping check failed by about one pixel and passed its isolated rerun. No word-cloud code was changed. Repository lint, separate Python Ruff checks and asset builds passed.

### Verification run, 14 September 2026

At the same dataset revision `2b37e609bb26a15cc47026301b35d056e54ed382`, the revised instrument selected the same 1,244 records (645 press, 406 periodicals, 5 archives, 188 scholarship, 0 YouTube), of which 768 carry the curated tag and 1,164 a retained core match. Membership is therefore unchanged by this release; what changed is what is counted inside it and what is shown about it. Category matches fell from 17,728 to 17,257, entirely through the family-law revision: `droit-famille` occurrences dropped from 1,377 to 906 — 115 to 90 in the press, 788 to 545 in periodicals, 473 to 270 in scholarship, and 1 unchanged in the archives. The concordance emitted 4,838 snippets (7,942 quotable of 17,257 occurrences, 9,315 withheld by the rights gate).

The membership routes across all subsets are 688 `tag+text`, 193 `text>=2`, 283 `text=1` and 80 `tag-only`; 90 members carry a core term in the title and 6 scholarly works are flagged bibliography-only. The screen aggregate published with the bundle reports 1,244 of 1,244 members screened and 1,081 read as substantive, by `claude-sonnet-5` under tier-2 rule `daf5e44a10`.

The Python suite passed 131 tests (plus 29 subtests), JavaScript passed 195, the four focused bilingual Laïcité browser tests passed, and the full browser run passed 57 of 57. Repository lint passed.
