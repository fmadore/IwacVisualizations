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

## Historical audits

The old documents remain available in Git history, rather than as competing
checklists in the working tree:

- [Refactoring audits through v1.68.0](https://github.com/fmadore/IwacVisualizations/blob/2c0252713e01470d16d5022ef37c043d912c8126/REFACTORING.md)
- [Original roadmap and implementation history](https://github.com/fmadore/IwacVisualizations/blob/2c0252713e01470d16d5022ef37c043d912c8126/ROADMAP.md)

Record future work here only when it has a concrete problem, scope and
acceptance criterion; do not reopen historical checkboxes as a backlog.
