# Native IWAC timelines

The **IWAC Timeline** page block replaces the Knight Lab embeds tracked in
[issue #5](https://github.com/fmadore/IwacVisualizations/issues/5). Its sources are
four CSV files committed under `content/timelines/`, English and French versions
of two exhibits. They began as the Knight Lab Google Sheets; since v1.83.0 those
sheets are no longer read by anything and can be retired.

| Exhibit | Slug | English page | French page | Dated events per locale |
| --- | --- | --- | --- | --- |
| Hajj in Burkina Faso | `hajj-burkina` | `westafrica/hajj-bf` | `afrique_ouest/hadj-bf` | 14 |
| Student Islamic activism | `aeemb-burkina` | `westafrica/student-activism-bf` | `afrique_ouest/militantisme-islamique-etudiant` | 11 |

Each bundle also has an undated introduction. `config/timelines.json` names each
source file (`content/timelines/<slug>.<locale>.csv`), the page it belongs on, and
the old sheet ID the migration below recognises in a Knight Lab iframe.

## Edit an exhibit

Open the CSV in Excel or LibreOffice, edit, and save it **as CSV UTF-8** under
the same name (Excel: *File → Save As → CSV UTF-8*). The files carry a UTF-8
byte-order mark so Excel reads the accents; the importer accepts the file with
or without it. The columns are TimelineJS's, plus `ID`. Commit the change: a push
to `main` that touches `content/timelines/**` starts **Regenerate visualization
data**, and **Pull latest data** in Omeka then publishes it.

Write quotation marks as typography, not as the keyboard's straight `"`:
“ ” and ‘ ’ in English, « » in French with a no-break space inside each
guillemet (U+00A0), and ’ for the apostrophe. The importer warns about any
straight double quote left in running text. A quotation set off from the text
is `<blockquote>…</blockquote>`, closed; the theme draws it.

## Generate and publish

```sh
python scripts/generate_timeline.py --minify
# Or through the common runner:
python scripts/run_all.py --only timeline
```

The importer reads the committed CSVs only; it makes no network request. The
output is `asset/data/timelines/index.json` plus `<slug>.en.json` and
`<slug>.fr.json`. These generated files follow the current data-release policy:
they are ignored by Git and published in the immutable data archive. They are
not bundled into the module release. `run_all.py` runs the importer as part of a
complete publication; `validate_data.py` checks the catalogue, every referenced
bundle, dates, HTML, IDs, provenance and orphan files before publication.
Changes to the source manifest trigger the same regeneration workflow as code
changes and as changes to `content/timelines/**`.

All sources are parsed and validated before any output is written. A file that
is not a TimelineJS CSV, unsupported nonempty columns, missing IDs and invalid
dates fail the build; they do not publish an empty replacement. The source path
and its SHA-256 are recorded in every bundle.

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
- Every dated row needs an **ID**: permanent lowercase letters, digits and
  hyphens, starting with a letter or digit; maximum 80 characters. `intro` is
  reserved and the introduction row leaves it empty. Share the same ID across
  translations; differences are reported for editorial review. The four
  exhibits' IDs (`event-01` …) are the ones their published links already use.
- **Media Alt** optionally supplies a concise image description. Otherwise
  the caption provides the alt text. Images are fitted, whole, into a fixed
  4:5 frame; clicking opens the original in a new tab. Captions, credits and
  IWAC links are preserved.
- Google Maps and unrecognised media URLs remain ordinary labelled links.
  There is no third-party iframe or automatic media execution.
- `Time`, `End Time`, `Group` and unknown nonempty columns fail validation.
  End month/day, display date and media credit are supported. Per-event
  background overrides are ignored with a warning so the theme owns colour.

HTML is sanitised with nh3 during import and HTMLPurifier at the PHP rendering
boundary. Only narrative tags and safe links survive. HTMLPurifier also gives
every absolute link `target="_blank" rel="noopener"`, so a link to an IWAC item
opens in a new tab and the reader keeps their place; the viewer tells screen
readers so through `aria-describedby`. The known trailing
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
into a narrative viewer. One toolbar above the event carries every control a
reader uses repeatedly: the Narrative / All events switch, previous and next,
the event picker and fullscreen, so none of them moves when the event changes.
The picker is the exhibit's table of contents, each event's date over its
headline, the current one marked; it opens from a button, takes the arrow keys,
Home and End, and closes on Escape or outside. In the all-events view it scrolls
to the event instead.

From a 768px-wide block, every event of the narrative shares one grid cell, so
the stage is as tall as the longest event and nothing below it (the closing
previous/next, the axis, the rest of the page) moves either. A phone keeps each
event's own height, since there the longest event runs to several screens. A
step taken below the stage (the closing buttons, the axis, a swipe) brings the
toolbar back into view when the event's start has scrolled away. Fullscreen uses
the browser's Fullscreen API, or the same layout as an overlay where it is
missing (an iPhone); the toolbar stays pinned while a long event scrolls. The
axis shows points and overlapping range lanes. Arrow keys,
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
php bin/migrate-timelines.php --omeka=/var/www/omeka-s --user-id=1

# Apply the same recognition rules and create a new private backup:
php bin/migrate-timelines.php --omeka=/var/www/omeka-s --user-id=1 \
  --apply --backup=/srv/private/iwac-timelines-before.json

# Preview a rollback; add --apply and a NEW --backup path to execute it:
php bin/migrate-timelines.php --omeka=/var/www/omeka-s --user-id=1 \
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
