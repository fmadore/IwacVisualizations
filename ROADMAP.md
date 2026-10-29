# Maintenance status and decisions

The repository refactoring is complete as of v1.68.1 (2026-09-10).
This document replaces the historical roadmap and refactoring checklists.
There is no remaining implementation backlog from those audits.

## What shipped

- Immutable, checksummed data generations with manifests, pinned source
  revisions, publication receipts, recoverable activation and persistent sync
  locking. Active data remains usable while a replacement is prepared.
- Shared deployment and asset-planning services, one sentiment-model registry,
  namespaced layout keys with legacy aliases, and shared publication ranking.
- Ordered bundles, per-block lazy loading, shared requests and translated
  retries. Shared chart, map, state, panel and generator helpers replace the
  duplication identified in the audits.
- Desktop layout restoration after mobile resizing; zoom and legend selections
  survive delayed layout redraws and theme changes.
- Readable thumbnail badges and slider tracks in both themes, plus real
  ECharts rendering and keyboard-accessible exact-value table checks.

Release-by-release details belong in [CHANGELOG.md](CHANGELOG.md). Current
implementation details belong in [ARCHITECTURE.md](ARCHITECTURE.md); setup and
features belong in [README.md](README.md). Generator usage and data contracts
are in [scripts/README.md](scripts/README.md) and [DATA_NOTES.md](DATA_NOTES.md).

## Decisions retained

| Proposal | Disposition |
| --- | --- |
| Self-host visualization libraries | Owner chose the existing pinned CDN hosting on 2026-09-10. |
| Rewrite all JavaScript as ESM | Not pursued: ordered, deduplicated bundles already provide the measured request reduction. Reconsider only with evidence of further benefit. |
| Migrate static overviews to a larger layout dispatcher | Declined after measurement: the trial added code and changed embed permalinks. Keep shared panel construction. |
| Parallel generator jobs | Superseded by the shared-process runner and FrameStore; sharding would duplicate dataset conversion. |
| Additional large-series flags and ECharts features | Retain the assessed settings and domain-specific behavior. Benchmark before changing them. |
| Blanket chart decals | Keep semantic palettes and exact-value tables/CSV. Keyboard access to dense-stack data is tested; this does not assert every colour pair is perceptually distinct. |
| Replace entity-network renderer | Keep the established renderer; no port is planned. |
| Port KnowledgeGraph or TopicNetwork | Deliberate non-ports. The retained legacy dashboard migration is complete. |

## Verification and production acceptance

The v1.68.0 implementation passed 182 JavaScript tests, 47 browser tests,
lint/build guards, and the Omeka integration matrix (4.0.0/PHP 8.1 and
4.2.1/PHP 8.5). Earlier publication work also passed PHP/Python behavioral
checks, PHPStan, full private-dataset regeneration and archive import validation.

The live site served module asset URLs with `v=1.57.0` when inspected on
2026-09-10. After installing the new release, smoke-test sentiment/reference
charts and article badges in both themes, resize a chart while zoomed, and
check data activation in the admin UI. Repository validation does not establish
that the new version has been deployed. No production deployment or live-data
mutation was performed during the refactoring.

## Cross-module review with DRE Visualizations (2026-10-28)

This module and its sibling [DRE Visualizations](https://github.com/AM-Digital-Research-Environment/DRE-Visualizations)
were compared structurally. This one is ahead on the front end and on its own
structure (block registry, asset plan, bundles, browser tests, Lighthouse);
DRE is ahead on the data side. These are the items taken from it; DRE's list
is in its docs/ROADMAP.md. Status: `[x]` done, `[ ]` open, `[-]` decided against.

| | Problem | Scope | Accepted when |
| --- | --- | --- | --- |
| [x] D1 | `innerHTML` and popup HTML had no automatic guard | `eslint-plugin-no-unsanitized` over the browser sources; MapLibre `setHTML` added as a sink | `npm run lint:js` fails on an unescaped sink (shipped with the HTML-string popup path removed) |
| [x] D2 | A notice inside a PHP predicate printed and the harness still passed | `tests/lib/strict-errors.php` in `tests/php/run.php` | any warning, notice or own deprecation fails the run |
| [x] D3 | A bare tag got auto-generated notes | `scripts/changelog-section.js` feeds `release.yml` | the release takes its title and notes from the CHANGELOG entry |
| [x] D4 | Dependabot proposed releases the day they appeared | `cooldown` on both ecosystems | — |
| [-] D5 | — | `php_version_constraint` in module.ini | Decided against: Omeka S reads only `omeka_version_constraint`, so the key would be decorative |
| [x] D6 | A push to a generator republishes the moving `data` release, which a site on the previous module version can pull: its JavaScript then reads a JSON shape it does not know | a `dataContract` integer written into the manifest by the generators and declared by the module; SyncData refuses an archive of another contract | an archive of another contract (or a malformed one) is refused before extraction with a log line saying what to do; the active generation stays live; `tests/php/run.php` fails while the two numbers differ |
| [x] D7 | The integration suites print warnings without failing | `tests/lib/strict-errors.php` in the four Omeka integration scripts; deprecations raised outside the module's own tree (Omeka core, vendor/) ignored, a warning or notice fails wherever it is raised | `omeka-integration.yml` fails on a warning the module raises (`block_assets.php` and `sync_form.php` run clean locally against 4.2.1; `omeka_boot.php` and `timeline.php` need the CI database) |
| [x] D8 | Generator output can change unnoticed: the Python tests are unit tests | `tests/python/test_golden.py` runs 25 generators through `run_all.run_one` on `golden_corpus.py` (synthetic, offline, clock frozen) and compares every JSON file with `tests/golden/` (`UPDATE_GOLDEN=1` to accept a change); the generators whose output depended on string-hash order now sort their ties | an unintended change to any covered output fails `lint.yml`, and the output is identical under any `PYTHONHASHSEED` |
| [x] D9 | Escaping of chart formatters is tested for one helper | `tests/js/formatter-sweep.test.js` builds every shared `chartOptions` builder with an `<img onerror>` payload in each text field and calls every tooltip formatter with params from the option's own series; a new builder fails until it is swept. It found the entity bar tooltip's unescaped occurrence dates, now escaped | a formatter that interpolates a raw label, or drops the label, fails `npm test` |
| [ ] D10 | No security policy | `SECURITY.md` | the repository shows a reporting route |

## Historical audits

The old documents remain available in Git history, rather than as competing
checklists in the working tree:

- [Refactoring audits through v1.68.0](https://github.com/fmadore/IwacVisualizations/blob/2c0252713e01470d16d5022ef37c043d912c8126/REFACTORING.md)
- [Original roadmap and implementation history](https://github.com/fmadore/IwacVisualizations/blob/2c0252713e01470d16d5022ef37c043d912c8126/ROADMAP.md)

Record future work here only when it has a concrete problem, scope and
acceptance criterion; do not reopen historical checkboxes as a backlog.
