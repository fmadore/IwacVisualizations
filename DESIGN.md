---
name: IWAC Visualizations
description: The data layer of the Research Broadsheet — ECharts and MapLibre panels that read the IWAC theme's tokens at runtime and encode data in the one colour namespace they own.
colors:
  model-1: "#10a37f"
  model-2: "#4d6bfe"
  model-3: "#f97316"
  model-4: "#1f7ff0"
  model-5: "#9333ea"
components:
  panel:
    backgroundColor: "var(--panel-bg, var(--surface, #fdfcfb))"
    textColor: "var(--ink, #13161c)"
    rounded: "var(--panel-radius, var(--radius-md, 0.5rem))"
    padding: "var(--space-4, 1rem)"
  button:
    backgroundColor: "var(--surface, #fdfcfb)"
    textColor: "var(--ink, #13161c)"
    rounded: "var(--radius-md, 0.5rem)"
    padding: "var(--space-2, 0.5rem) var(--space-3, 0.75rem)"
  button-hover:
    backgroundColor: "var(--surface-raised, #faf8f6)"
    textColor: "var(--ink, #13161c)"
  tab:
    backgroundColor: "transparent"
    textColor: "var(--muted, #66696e)"
    rounded: "var(--radius-md, 0.5rem)"
    padding: "var(--space-1, 0.25rem) var(--space-3, 0.75rem)"
  tab-active:
    backgroundColor: "color-mix(in oklab, var(--primary, #ce4115) 12%, var(--surface-raised, #faf8f6))"
    textColor: "var(--ink, #13161c)"
  chip:
    backgroundColor: "color-mix(in oklab, var(--primary, #ce4115) 12%, var(--surface, #fdfcfb))"
    textColor: "var(--ink, #13161c)"
    rounded: "var(--radius-full, 9999px)"
    padding: "0.2rem 0.6rem"
  control:
    backgroundColor: "var(--surface, #fdfcfb)"
    textColor: "var(--ink, #13161c)"
    rounded: "var(--radius-md, 0.5rem)"
    padding: "var(--space-2, 0.5rem) var(--space-3, 0.75rem)"
  toolbar-button:
    backgroundColor: "transparent"
    textColor: "var(--ink-light, #3f4349)"
    rounded: "var(--radius-md, 0.5rem)"
    size: "var(--size-control-sm, 2.25rem)"
---

<!--
  PROVENANCE — read this before adding a value here.

  This is a CONSUMER repo. The IWAC theme is the single source of truth for
  design tokens; `tokens.json` at this repo's root is a SYNCED COPY written by
  IWAC-theme/scripts/build-tokens.js, never hand-edited here.

  So the frontmatter deliberately does NOT mirror the theme's palette, type
  ramp, radii, spacing or breakpoints. Mirroring them would stand up a second
  authority in a repo whose whole contract is that it has none. Two things are
  recorded instead:

    * `colors` — only the four values this module genuinely OWNS: the AI model
      role-slot accents, literal hexes carried under `/* allow-hex */` in
      asset/css/iwac-core.css. Every other module-owned colour
      (--iwac-vis-sent-*, -cent-*, -subj-*, -heatmap-*) is a DERIVATION from a
      theme token, not a value, and is recorded as its formula in the Colors
      section and in .impeccable/design.json.
    * `components` — the FALLBACK-ASSERTION CONTRACT in situ. Each value is
      written the way the stylesheet writes it: `var(--theme-token, <literal>)`,
      where the literal equals the theme's canonical LIGHT value. That equality
      is not documentation, it is asserted — `npm run lint:theme`
      (scripts/check-theme-tokens.js, rules 4/7/8) fails the build on drift, and
      rule 6 fails on a token name the theme does not publish.

  The SIDECAR is a different case from this frontmatter, and since theme
  v2.14.0 it carries more than this file does. `.impeccable/design.json` holds
  the module-owned `model-*` entries AND the theme's full resolved palette
  under `extensions.colorMeta`, keyed `theme/<token>` — written into this repo
  by `IWAC-theme/scripts/build-tokens.js` on `npm run sync:tokens`, in the
  same run and from the same SCSS as `tokens.json`.

  That is not a second authority, because nothing here maintains it: the
  `theme/` keys are deleted and rewritten on every sync, so an upstream
  removal propagates. It exists because the Impeccable design detector reads
  the palette from DESIGN.md + sidecar, and with only four colours declared it
  flagged all 152 correct `var(--token, #hex)` fallbacks in iwac-core.css as
  unknown colours. It now reports zero there and still catches a genuinely
  non-theme hex. `npm run lint:theme` remains the stronger, authoritative
  check; the sync only makes the detector agree with it.

  Upstream artifact layer (register, North Star, palette, type ramp, named
  rules): IWAC-theme/DESIGN.md + IWAC-theme/.impeccable/design.json.
  Cross-repo token contract: IWAC-theme/docs/DESIGN-SYSTEM.md.
  Recorded from the shipped source at module v1.53.0.
-->

# Design System: IWAC Visualizations

## Overview

**Creative North Star: "The Broadsheet's Data Page"**

The theme's world is [The Research Broadsheet](../IWAC-theme/DESIGN.md) — a 20th-century
newspaper operated as a scientific instrument. This module is that broadsheet's data
page: the charts, tables and maps a newspaper prints when it has counted something. It
inherits the whole register — density over comfort, rules as joinery, quiet controls,
one accent used sparingly — and adds nothing to it. What it adds is **encoding**: the
grammar by which a country, a sentiment grade, a resource type or an AI model becomes a
colour, and the rules that keep that grammar honest when the surface flips to dark, when
an admin retunes the brand seed, or when the theme is absent altogether.

The governing fact is physical: a `<canvas>` sits outside the cascade. Nothing in a
chart can inherit. So every colour, every font stack, every axis tint is *read* from the
live custom properties at render time and converted to a legacy `rgb()` the chart engine
can deconstruct. That single constraint produces most of this system: the runtime token
reader, the paired light/dark fallback objects, the computed-not-listed contrast rules,
the theme observer that repaints instead of remounts.

The second governing fact is that this repo owns no visual identity. It owns one CSS
namespace (`--iwac-vis-`) and one class prefix (`.iwac-vis-`). Everything else resolves
upstream, with a guarded fallback for the degraded case. A value that looks like brand
appearing in this repo is a defect, not a decision — and the token guard is written to
say so out loud.

**Key Characteristics:**
- A consumer, not an author: one namespace, one class prefix, everything else upstream
- Colour is encoding, never chrome — the module's own tokens all carry data meaning
- Derivations mix toward `--surface` / `--ink`, never toward black or white
- Panels are the theme's sanctioned exception to flatness; everything inside them is flat
- Contrast decisions are computed per theme, per call — never listed
- Every consumed token carries a fallback the build asserts against `tokens.json`

## Colors

The module holds no palette. It holds **scales** — each one either derived from a theme
token by an explicit formula, or (in exactly four cases) a literal it owns outright.

For the surface, ink, border, status and resource-type palettes, and for the twenty-slot
categorical series scale: see IWAC-theme/DESIGN.md. Nothing about them is restated here.

### Owned literals — AI model accents

- **Model slots 1–5** (`--iwac-vis-model-1..5`): five per-model data-series accents used
  where the Sentiment Atlas draws every annotator model at once. They are **role slots
  numbered by position, not by model id**; the id → slot map lives in `MODEL_SLOT`
  (charts/sentiment-atlas.js) and nowhere else. Slot 4 is deliberately a darkened,
  cyan-leaning blue rather than the model's own indigo, which was all but slot 2 — the
  subjectivity trend needs ~20° of hue and a clear lightness step to keep two blues apart.
  Slot 5 (v1.55.0) is the same fix against the same neighbour: the model's own mark is a
  flat `#615ced`, hue 242 against slot 2's 230 at the same lightness, which is no
  separation at all on that chart. The slot carries the hue on to a true violet at 271° —
  41° from slot 2, a clear step down in lightness, still reading as the purple the mark
  actually is. With five lines drawn, no two sit within 40° of each other.

### Derived scales — sentiment

- **Polarité** (`--iwac-vis-sent-*`), divergent, five grades plus N/A. The two halves are
  derived *differently and deliberately*. The negative half takes its two steps from two
  distinct theme tokens — `--warning` then `--error` — so the step is a change of hue
  (ΔE ≈ 40 in both themes). The positive half has only `--success`, so its weaker grade
  is `--success` mixed 55% toward `--surface`: the weak grade sits nearer the background,
  the strong grade *is* the token. N/A falls to `--border-light`.
- **Centralité** (`--iwac-vis-cent-1..4`), sequential, `--primary` fading toward
  `--surface` at 75 / 50 / 30%.
- **Subjectivité** (`--iwac-vis-subj-1..5`), sequential, the same ramp read the other way:
  15 / 35 / 55 / 75% then `--primary` itself for "highly subjective".
- **Heatmap** (`--iwac-vis-heatmap-0..4`), sequential, 8 / 28 / 50 / 75% then `--primary`
  — the same construction, so every sequential chart in the module lands on one ramp.

### Consumed encodings

- **Categorical series**: read live from the theme's `--series-1 … --series-20` at
  `document.body`. Slots 1–2 alias `--primary` / `--secondary` and are read live so an
  admin-tuned brand seed reaches the charts; slots 3–20 are read live too, which is what
  makes a future divergent dark scale a theme-side value edit with no change here. The
  hex arrays in `iwac-theme.js` are the **degraded-mode fallback only** — embed routes
  and foreign themes — and `lint:theme` rule 11 deep-equals them, the lead-slot count and
  *which tokens hold the leads*, against `tokens.json`'s `series`, light and dark checked
  separately.
- **Resource type**: the theme's fixed `--type-*` map, rendered as a dot on an outlined
  badge, exactly as upstream. The pipeline's `image` key maps to `--type-photograph` —
  the theme names the token after what the thing is, the pipeline after its subset.

### Named Rules

**The No Second Palette Rule.** `--iwac-vis-` is for values the theme should not carry:
data-encoding colour and module-local layout constants with no theme equivalent. It is
not a place to re-declare a theme token. `--iwac-vis-icon-btn-sm: 28px` was
`--size-control-xs` to the pixel and the shadow tints re-derived what `--shadow-color*`
already publishes; both are gone. The guard exempts the full prefix only, so a shortened
one (`--iwac-otd-…`) fails.

**The Mix-Toward-Surface Rule.** A derived swatch mixes toward `--surface` or `--ink`,
never toward black or white. Black and white are the two colours in the palette that are
not theme-relative, so a ramp built on them inverts when the surface goes dark:
`-sent-pos-strong` was `--success` mixed 18% toward literal black until v1.50.0, which
left the most emphatic grade on the scale as the dimmest thing on the chart in dark mode
(4.96 against 8.28 for the grade below it). A theme-pinned block that already knows which
way is up opts out with `/* allow-absolute-mix */`.

**The Role-Slot Rule.** A model accent is a *position*, never an identity. These tokens
were once named from the Hugging Face column prefix, so every model upgrade renamed a
design token and orphaned the rules referencing it. A version identifier is not a design
decision.

**The Computed-Not-Listed Rule.** Which palette slots may carry **text** is computed from
the live palette against the live `--panel-bg`, per theme, per call — never enumerated.
Measured against the light panel 13 of 20 slots sit under 4.5:1; against the dark panel a
different 5 do; there is no subset that works in both. A hardcoded list would be correct
until the next palette edit and wrong silently thereafter. When nothing qualifies the
code falls back to the ink token: monochrome-and-readable beats varied-and-not.

**The Live-Read Rule.** Chart colour is read through `getComputedStyle` and resolved to a
legacy `rgb()` before it reaches the engine — never hardcoded, never handed over as
`color-mix()`. The parser cannot deconstruct modern colour syntax, so a `color-mix()`
series colour paints correctly at rest and vanishes on hover. Opacity variants go through
`ns.withAlpha`, which emits a flat `rgba()` that survives the engine's own lift/darken.

**The Panel-Not-Surface Rule.** Anything measuring contrast against the box it sits in
reads `--panel-bg`, not `--surface`: the theme aliases `--panel-bg` to `--surface` in
light and to `--surface-raised` in dark. Guessing is wrong in exactly one theme, which is
the hardest kind of wrong to see.

## Typography

The module ships **no faces and no ramp**. Type resolves entirely from the theme: see
IWAC-theme/DESIGN.md for the Besley / Public Sans / Source Serif 4 pairing and the
ten-step scale. Two consumption rules are the module's own.

### Named Rules

**The Charts-Inherit-The-Body-Face Rule.** The chart theme reads
`getComputedStyle(document.body).fontFamily` and hands it to every axis, legend and
tooltip, so canvas type never visibly clashes with the page around it. Naming a family in
chart code is how every chart on the site once rendered in Inter on a Public Sans page.

**The Panel-Titles-Are-UI Rule.** Panel titles are sans-serif at `--text-base`/600 —
they are labels above charts, not editorial headings. The serif treatment is reserved for
the block-level section heading, which is what ties a block into the page's `h1`/`h2`
rhythm. Heading *level* is an outline decision, not a style one: `buildPanel` emits `h4`
by default, `h3` under a block heading promoted to `h2`, `h2` for a block sitting directly
under the page `h1` — and the level never changes the size.

**The Token-Or-Nothing Rule.** `font-size` comes from a `--text-*` token, inside
`clamp()` included. Roughly 91 literals here once ran a second, undeclared 12/14/18px
scale against the theme's 11/13/15/17/19; four inline fluid ramps hid from the guard
inside `clamp()` until it learned to read the whole value.

## Layout

Blocks are guests. A block is a `.iwac-vis-block` in the host page's content column,
spaced `var(--space-8)` from its neighbours, and it never reaches outside that column.
Inside, the recurring unit is the **panel grid**: an auto-fitting grid of
`.iwac-vis-panel` cards each holding one chart host with a reserved height, so a slow
fetch does not collapse the page and shove the sections below it.

Spacing, radii and control sizes are the theme's scales, consumed by token. The module
adds three module-local ramps with no theme equivalent: thumbnail sizes
(`--iwac-vis-thumb-*`, 40/48/56px with slightly wider column widths), and a 96px
panel-header reservation (`--iwac-vis-panel-toolbar-reserve`) so a trailing badge cannot
collide with the download / fullscreen buttons injected into the header.

Breakpoints are the theme's published contract, and they are asserted: a media width must
be one of the theme's six, `min-width` sits **on** a breakpoint and `max-width` at
**breakpoint − 1**. `blocks/laicite.css` reflowed at 640px under a `/* sm */` comment while
the theme's `sm` — and every other block on the page — is 600.

### Named Rules

**The Reserved-Height Rule.** A chart host declares its height before its data arrives.
Panels that render a placeholder into the chart itself use the shared empty-chart option
rather than emptying the host, so the reserved space survives an empty slice.

**The Documented-Media-Width Rule.** `@media` cannot read a custom property, so the three
widths this module reflows at are written as literals *and* named in the stylesheet
header — and the guard checks them against the published breakpoints, because a comment
saying `/* sm */` beside the wrong number is what "documented" looked like right up until
it was wrong.

**The Records-Not-Columns Rule.** Below `sm` a data table is re-laid as a list of records:
thumbnail floated, headline on top, every remaining cell a labelled datum. It reflows on a
**container** query, not a media query, because what fails is the table's own width — a
half-width panel on a laptop is the same failure as a phone — and `check-theme-tokens.js`
exempts `@container` from the breakpoint rule for exactly that reason. Three things are
load-bearing. The record is separated by the row's existing hairline and nothing else, per
Rules-Not-Boxes and Flat-Inside-The-Panel; a bordered card inside a panel would be a
nested box. Every field is carried, never hidden — the column-hiding this replaced left a
phone reader a list of titles with no provenance and no date. And each datum is an
`inline-block` bounded by `max-width`: a label and its value are adjacent inline boxes with
no whitespace between them, so a handle or a slug is one unbreakable word running from the
start of the label, and as plain inline text it leaves the panel.

**The Roles-Survive-The-Display-Flip Rule.** Changing `display` on a table strips its
implicit table semantics in every engine, so `buildTable` declares `table` / `rowgroup` /
`row` / `columnheader` / `cell` explicitly and the header row is *clipped*, never
`display: none`. The visible card labels are `aria-hidden` for the same reason from the
other side: the header they echo is still being announced, and printing both would name
every field twice. A column's `width` rides `--iwac-vis-col-w` rather than
`style.width`, because an inline width outranks every stylesheet rule — including the ones
that stop the cell being a column at all.

## Elevation & Depth

Flat inside, one shadow at the boundary. The theme's Rules-Not-Boxes doctrine holds
everywhere except the one place it sanctions a box: a chart panel is a true panel, so
`.iwac-vis-panel` takes `--shadow-sm`, a 1px `--border` hairline and `--panel-radius`.
Nothing *inside* a panel casts a shadow — tabs, chips, keys, window notes, tables and
summary cards are drawn with hairlines, tints and type. The one floating element is the
chart tooltip, which carries its own 8px-radius drop shadow because it leaves the panel's
box entirely (`appendTo: 'body'` to escape ancestor `overflow: hidden`, `confine: true` so
it does not drift off a phone).

The panel border is written unrolled as `1px solid var(--border, …)`, not through the
theme's composite `--panel-border` shorthand: a composite wrapping another `var()` can
freeze that inner substitution at the block where it is declared, which once painted a
dark blue-grey line across light-mode cards for anyone whose OS preferred dark.

### Named Rules

**The Flat-Inside-The-Panel Rule.** The panel's own shadow is the module's entire
elevation budget. If a control inside a panel needs to read as raised, it is the wrong
control.

**The Structural-Stripe Exception.** A `border-left` / `border-right` of 2px or more is
allowed **only** as a structural data marker — the multi-colour sentiment-card model
indicator, the compare-corpus A/B edge. As decoration on a card or callout it is banned,
per the theme.

## Shapes

Rectilinear, borrowed whole from the theme: `--radius-md` on panels, buttons, tabs and
form controls; `--radius-full` reserved for chips and circular icon controls. The one
shape the module authors itself is the **2px corner on a data mark** — the key swatch is
drawn at 2px specifically to match the corner the Gantt's `renderItem` draws on each bar,
so the legend and the chart are visibly the same object.

## Components

Every class in this section is prefixed `.iwac-vis-`. That prefix is the module's whole
claim on the page.

### Panel

The unit of the system: `--panel-bg` ground, 1px hairline, `--panel-radius`,
`--space-4` padding, `min-width: 0` so a canvas cannot force grid overflow. Built by
`P.buildPanel(className, title, description, opts)`, which emits the title at the level
the surrounding outline needs and an optional muted description line beneath it. A
fullscreen variant promotes one panel to the viewport; the header carries an injected
toolbar (download, fullscreen, copy-embed) whose buttons are `--size-control-sm` squares.

### Chart Host

`role="img"`, `tabindex="0"`, and an `aria-label` carrying an authored, localized
description of what the chart shows. Three behaviours make that hold:
- the description is applied **after** the render callback, because callbacks rebuild the
  whole option with `setOption(option, true)` and would discard anything injected earlier;
- `setOption` is patched once per instance so the description is re-applied on **every**
  call — a facet change, a tab, a pagination step otherwise swapped a 108-character
  localized description for a 2,500-character English recitation;
- the label rides the **host**, because `role="img"` prunes the subtree where the engine
  hangs its own label, and an unlabelled focusable div is worse than no focus at all.

Where a chart carries a `dataZoom`, arrow keys move the window by a quarter span, PageUp /
PageDown by a full span, Home / End to the ends — dispatched through the engine's own
action API. `preventDefault` fires only once the handler knows it is acting, so an arrow
key on a chart with no window still scrolls the page.

### Buttons

Quiet by default, matching the theme's inversion. `.iwac-vis-btn` is a `--surface` fill
with a 1px `--border`, `--radius-md`, `--text-sm`; hover raises to `--surface-raised` and
tints the border 40% primary; focus is `--focus-outline` at 2px offset; disabled drops to
0.5 opacity. `--sm` and `--ghost` modifiers exist; there is no loud variant, because
nothing in a data panel is the page's call to action.

### Tab Group

A flex row over a `--border-light` hairline. Tabs are transparent with `--muted` text at
weight 500; hover goes `--surface-raised` + `--ink`; the active tab takes a 12% primary
wash on `--surface-raised` with a 40% primary border — a tint and a border, never a filled
orange. State is announced with **`aria-pressed`**, not `aria-selected`: these are toggle
buttons in a labelled group, not an ARIA tablist with tabpanels, and claiming the tablist
pattern without its structure is worse than not claiming it.

### Facet Chips

`--radius-full` pills at `--text-xs`, 12% primary on `--surface`, bordered 40% primary,
deepening to 22% / 60% on hover, `aria-pressed` for on/off. Used where a filter is a set
membership rather than a single choice.

### Form Controls

One rule for every `<select>` and text input in the module: `.iwac-vis-control` —
`--surface` ground, 1px `--border`, `--radius-md`, `--text-sm`, primary focus ring. The
class is applied centrally by `P.buildSelectControl` / `P.buildSearchDropdown`. Until
v1.23.0 the shared sheet enumerated each block's private control class instead, so adding
a control meant editing core.

### Window Disclosure (signature)

**A dateline, not a banner.** When a chart is windowed, `P.buildWindowDisclosure` prints a
muted one-line standing statement — "showing 20 of 82" — with a text-link toggle beside
it: no box, no icon, no call to action, because expanding a chart is a reading choice and
not the panel's headline. The text is `role="status"` / `aria-live="polite"` so the count
is announced when it changes; the toggle carries `aria-expanded`. **It is hidden entirely
when nothing is being hidden** — a disclosure that fires on a 6-row chart trains the
reader to ignore it on an 82-row one.

### Chart Key (signature)

A flat inline list of `--text-2xs` items, each a 0.75 × 0.5rem swatch at the data mark's
own 2px corner plus an `--ink-light` label. It is the module's answer to a legend that
would otherwise print across the bars.

### Failure States

Three distinct outcomes, deliberately not one:
- **Loading** — a spinner with a localized message, held only where the panel is actually
  in view (`P.lazyInit`), so an off-screen map never paints a spinner it will not resolve.
- **Fetch error** — the error state plus a **Try again** button wired to the caller's
  retry. Fetches carry an explicit timeout, so a hung request fails rather than spinning
  forever.
- **404 → "not published yet"** — an HTTP 404 is routed to the *no-data* banner, not the
  error state. A missing precompute bundle is a publication state, not a fault, and
  offering "Try again" for it is a lie. Blocks with nothing to show (On This Day on a bare
  date, Item Set Dashboard off-corpus) remove themselves silently instead.

### Map Panels

MapLibre has been ESM-only since v6 and cannot ride the classic script chain, so the
on-view loader `import()`s it in parallel and publishes the promise; `P.whenMaplibre()`
is the single gate everything passes through, and `P.withMaplibre(host, build)` holds a
spinner and swaps in the standard "map unavailable" banner if the import fails. If no
import was ever armed — the block declared no map need, or it is an embed route — the
promise **rejects** rather than hanging. Basemaps follow the theme: Carto positron in
light, dark-matter in dark, swapped by `setStyle()` on the same observer that re-themes
the charts.

## Do's and Don'ts

### Do:

- **Do** resolve every colour, font and size from a theme token with a fallback equal to
  the theme's canonical light value, and let `npm run lint:theme` compare it.
- **Do** read chart colours at runtime through `iwac-theme.js` and register charts via
  `IWACVis.registerChart()` — one theme observer repaints them all.
- **Do** derive a new scale by mixing `in oklab` toward `--surface` or `--ink`.
- **Do** compute a contrast decision from the live palette against `--panel-bg`, per
  theme, per call.
- **Do** give every chart host `role="img"`, a focusable `tabindex`, and an authored
  localized description that is re-applied after every `setOption`.
- **Do** name a data-role token by its **position** when its identity can be upgraded.
- **Do** route client-rendered strings through `iwac-i18n.js` and PHP strings through
  Omeka's translator, and recompile `language/fr.mo` with every `fr.po` edit.
- **Do** use `--focus-outline` for focus, and reach for `--ring-focus` only where an
  outline would be clipped by an overflow or scroll ancestor.

### Don't:

- **Don't** declare a token in `--iwac-vis-` that the theme already publishes — that is a
  competing variable living legally inside the module namespace.
- **Don't** hardcode a hex, `rgb()` or `hsl()` outside a `var()` fallback slot; sanctioned
  data-series literals carry `/* allow-hex */` and are counted.
- **Don't** mix toward black or white, or use `color-mix(in srgb …)`.
- **Don't** hand a `color-mix()` or `calc()` string to a chart — compose opacity with
  `ns.withAlpha` so the engine can still lift it on hover.
- **Don't** measure contrast against `--surface` when the thing sits in a panel.
- **Don't** enumerate which palette slots are readable as text.
- **Don't** shadow anything inside a panel, or add a decorative side-stripe to a card or
  callout.
- **Don't** claim the ARIA tablist pattern for a row of toggle buttons; `aria-pressed` in a
  labelled group is what the markup actually is.
- **Don't** offer "Try again" for a 404 — an unpublished bundle is a state, not a fault.
- **Don't** write an absolute `font-size` literal, inside `clamp()` included, or reflow at
  a width the theme does not publish.
- **Don't** edit `asset/css/**/*.min.css` or `asset/js/**/*.min.js` — they are generated.
