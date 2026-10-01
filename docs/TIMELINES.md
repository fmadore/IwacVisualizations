# Native IWAC timelines

The **IWAC Timeline** page block replaces the Knight Lab embeds tracked in
[issue #5](https://github.com/fmadore/IwacVisualizations/issues/5). Four published
Google Sheets remain authoritative: English and French versions of two exhibits.

| Exhibit | Slug | English page | French page | Dated events per locale |
| --- | --- | --- | --- | --- |
| Hajj in Burkina Faso | `hajj-burkina` | `westafrica/hajj-bf` | `afrique_ouest/hadj-bf` | 14 |
| Student Islamic activism | `aeemb-burkina` | `westafrica/student-activism-bf` | `afrique_ouest/militantisme-islamique-etudiant` | 11 |

Each bundle also has an undated introduction. The source URLs and destination
page slugs are in `config/timelines.json`.

## Generate and publish

```sh
python scripts/generate_timeline.py --minify
# Or through the common runner:
python scripts/run_all.py --only timeline
```

The output is `asset/data/timelines/index.json` plus `<slug>.en.json` and
`<slug>.fr.json`. These generated files follow the current data-release policy:
they are ignored by Git and published in the immutable data archive. They are
not bundled into the module release. `run_all.py` runs the importer as part of a
complete publication; `validate_data.py` checks the catalogue, every referenced
bundle, dates, HTML, IDs, provenance and orphan files before publication.
Changes to the source manifest trigger the same regeneration workflow as code
changes. Sheet-only edits require running **Regenerate visualization data** and
then **Pull latest data** in Omeka.

All sources are parsed and validated before any output is written. Failed
fetches, sign-in pages, unsupported nonempty columns, missing IDs and invalid
dates fail the build; they do not publish an empty replacement. Source URL and
SHA-256 are recorded in every bundle. For offline reproduction, use
`--csv-dir=/path/to/csv`, with files named `<slug>.<locale>.csv`.

## Content contract and authoring

Schema version 1 contains `slug`, `locale`, `title`, `events`, `metadata` and
import `warnings`. Each event has a permanent `id`, `headline`, `textHtml`,
`start`, `end`, `displayDate`, `sourceOrder`, `media`, and `relatedResources`.
Dates are objects such as `{"value":"1996-04","precision":"month"}`. Start
and end precision are independent. A year or month is displayed at its actual
precision; the axis uses calendar bounds without timezone conversion.

- The first undated row is the introduction. A dated `Type=title` row is kept
  as an event with a warning: the English activism sheet currently has one.
- Narrative navigation preserves authored order. The reading view is sorted
  chronologically, with original order breaking ties.
- Add an **ID** column for new events. Use permanent lowercase letters,
  digits and hyphens, starting with a letter or digit; maximum 80 characters.
  `intro` is reserved. Share the same ID across translations.
- Existing events use the frozen `legacyIds` map. Matching uses media URL or
  the full date tuple, never headline or current row number. A changed media
  URL needs an explicit ID or an updated map entry retaining the old ID.
  Translation ID differences are reported for editorial review.
- **Media Alt** optionally supplies a concise image description. Otherwise
  the caption provides the alt text. Images retain their full aspect ratio;
  clicking opens the original. Captions, credits and IWAC links are preserved.
- Google Maps and unrecognised media URLs remain ordinary labelled links.
  There is no third-party iframe or automatic media execution.
- `Time`, `End Time`, `Group` and unknown nonempty columns fail validation.
  End month/day, display date and media credit are supported. Per-event
  background overrides are ignored with a warning so the theme owns colour.

HTML is sanitised with nh3 during import and HTMLPurifier at the PHP rendering
boundary. Only narrative tags and safe links survive. The known trailing
`<blockquote>` typo is repaired when its meaning is unambiguous; ambiguous
unbalanced quotations fail for an author to correct. `relatedResources`
extracts IWAC item/item-set IDs from the preserved links for future cross-links;
the importer does not read or join the Hugging Face dataset.

## Editor, reading and interaction

Add **IWAC Timeline** in the page block picker. Choose an exhibit, content
language (site language by default), initial view, and optional opening event
ID. The catalogue comes from the active, verified data generation in `files/`,
never a glob of the module's ignored data directory. An unavailable selection
stays visible in the editor until the corresponding data is imported.

PHP renders all text, media and native event anchors. JavaScript enhances this
into a narrative viewer with previous/next, a labelled event selector, an axis
of points and overlapping range lanes, and an all-events view. Arrow keys,
Home and End operate only while focus is inside the timeline; form fields and
links retain their own keyboard behaviour. Horizontal touch swipes change the
event, while vertical scrolling remains available. Controls and axis targets
are at least 44 px. Status changes are announced without moving focus into the
article. Print and JavaScript-disabled pages show the complete reading view.

Share an event with its **Link to this event** anchor:

```text
#timeline=aeemb-burkina&slide=event-03&block=block-123
```

The optional `block` parameter disambiguates repeated instances. Without it,
the first instance of that exhibit handles the link. Unknown IDs leave the
current event intact. Native `#block-123-event-03` anchors also work, including
without JavaScript. Block IDs are preserved by the migration below.

The visual design follows IWAC-theme 2.22's press-archive direction: Besley
headings, Source Serif 4 prose, Public Sans controls, ink rules, paper surfaces
and quiet controls. CSS consumes the theme's public tokens and changes theme
without rebuilding or losing selection. No ECharts registration is necessary
for a DOM-only viewer. It loads only the existing shared core and its small
locale-specific bundle through the normal lazy asset loader.

## Migrate the four existing pages

Install the module release and pull a data release containing the four
bundles first. Run from the installed module directory as the server operator,
using an active Omeka global administrator's numeric user ID:

```sh
# Read-only preview, the default:
php scripts/migrate_timelines.php --omeka=/var/www/omeka-s --user-id=1

# Apply the same recognition rules and create a new private backup:
php scripts/migrate_timelines.php --omeka=/var/www/omeka-s --user-id=1 \
  --apply --backup=/srv/private/iwac-timelines-before.json

# Preview a rollback; add --apply and a NEW --backup path to execute it:
php scripts/migrate_timelines.php --omeka=/var/www/omeka-s --user-id=1 \
  --restore=/srv/private/iwac-timelines-before.json
```

The command recognises only the configured source iframe on its configured
site/page. It refuses missing/ambiguous matches, changed sources, mixed-content
HTML blocks and missing data. Already migrated pages are skipped. Apply locks
and rechecks each target, writes a private backup outside the web tree, then
changes only the matched block's layout and data in one database transaction.
Page content, block IDs, positions, attachments and layout settings are retained.
Rollback refuses to overwrite an edited target. Keep the backup until the four
pages have been checked in both languages and themes.

This repository change does not itself modify the live Omeka installation.

## Verification

Run `npm run build`, `npm test`, `php tests/php/run.php`, Python unittest
discovery under `tests/python`, and `npx playwright test timeline.spec.js`.
The browser fixture is rendered from the production reading partial:

```sh
php tests/browser/render-timeline.php > tests/browser/fixtures/timeline.html
```

CI also renders the registered block and editor through real Omeka/Laminas on
the supported version matrix, checks PHP HTMLPurifier, and verifies that the
timeline asset manifest does not load ECharts. Browser tests cover no-JS,
print, scoped keyboard input, repeated blocks, hash changes, touch targets,
reduced motion, failed media and WCAG A/AA checks in both themes.

Local previews using the imported sheet content and IWAC-theme’s stylesheet:
[English / light](images/timeline-light.png),
[French / dark](images/timeline-dark.png),
[French / mobile](images/timeline-mobile.png).
These are implementation previews, not screenshots of a deployed migration.
