# Claude Nav — Domo App Studio Custom Nav Bar

A drop-in navigation/filter bar for a Domo custom app, wired directly to the `BudgetBlindsData` dataset.

- Subtle gray bar background, single row, no per-control caption — compact pills instead
- Dropdown filters: **Brand**, **Master ID**, **Owner**, **Territory**, each a native `<select>` styled as a pill (see below for why)
- **Reporting Period** segmented control: MTD / QTD / YTD / Custom (with a From/To date popover)
- **Compare** dropdown
- Seafoam-green accent on focus, an active filter, and the active period pill

## Files

```
manifest.json   Required by Domo — app metadata, size, and dataset mapping (datasetsMapping)
index.html      The nav bar markup + a placeholder content area for the rest of your page
styles.css      All nav bar styling (CSS variables at the top for easy re-theming)
app.js          Dropdown behavior, Reporting Period logic, and the domo.get/filterContainer wiring
```

## Preview it

Open `index.html` in a browser (or `python3 -m http.server` from this folder). Outside of a real Domo runtime, `domo` is undefined, so `app.js` skips every `domo.get`/`domo.filterContainer` call and just leaves the static placeholder `<option>`s in place (Two Maids, Owner A, etc.) — the bar is still fully interactive for design/layout work.

## Why native `<select>` instead of a custom dropdown menu

This app runs inside an iframe sized to its Domo card. A custom `position: absolute` menu (what this used to be) gets clipped the instant it would extend past that card's box — no `z-index`, `position: fixed`, or portal trick fixes that, because the clip is the iframe's own boundary, not a CSS `overflow` setting on some ancestor. That showed up as "the dropdown opens under the card and I have to scroll."

Native `<select>` sidesteps it: the browser paints an open select's option list at the OS/window layer, above the page and above iframe boundaries — the same reason `<input type="date">`'s calendar in the Custom range fields already worked fine. Switching all five dropdowns (Brand/Master ID/Owner/Territory/Compare) to `<select>` fixes the clipping outright.

The trade so this can happen: the trigger pill is fully custom-styled (`.pill-select` in `styles.css`, via `appearance: none` + a background-image chevron), but the open option list itself renders with OS chrome — no seafoam hover states inside it, since that layer isn't part of the page's DOM/CSS. That's not a missed detail, it's the mechanism that makes the fix work.

This also let the per-control small-caps label go away: each select's first `<option value="">` (e.g. "All Brands") is self-describing, so the bar dropped from a two-line block per control to one compact pill — most of the height savings you asked for. A selection other than "All ..." gets a filled `.filtered` pill (seafoam background/border) so an active filter is still visible at a glance without the caption.

## Why a selection used to "filter and reset" — and how it's fixed

`domo.filterContainer()` changes the page's filtered view, and Domo reloads cards bound to that view — including this app's own instance, since it queries `BudgetBlindsData` too. That reload re-runs `app.js` from the top, which used to rebuild the segmented control/dropdowns from `index.html`'s static defaults (MTD active, "All ..." selected) and then unconditionally re-push MTD — wiping out whatever had just been selected a moment earlier.

The fix is `localStorage`: every selection (period, custom From/To, each dropdown, Compare) is saved to `navState` under the key `claudeNav.state.v1` as it's made. On load/reload, `selectPeriod(navState.period, false)` and `restoreDropdownSelection(...)` read that back and re-push *that* filter instead of the static default — so a reload reproduces the same selection rather than resetting it.

Because `localStorage` is shared across same-origin iframes, this also means placing the same app on multiple Studio pages keeps them in sync — pick YTD on one page and another page's copy of this app opens already on YTD and pushes the same filter to its own cards. That cross-page sync assumes each page's App Code instance is served from the same origin; if your Domo instance sandboxes each instance separately, the reset bug is still fixed, it just won't sync between pages — worth a quick side-by-side check once this is live.

## How the pieces fit together

`data-column` on each `<select data-dropdown>` in `index.html` holds the **raw dataset column name** — `Brand`, `HFCMasterID`, `FranchiseName`, `TerrNum`. That's what `domo.filterContainer()` needs, because it's pushing a filter to *other* cards on the page, which only know real column names. The Compare select has `data-dropdown` but no `data-column`, marking it as cosmetic-only (see below).

`app.js` also needs the **field alias** from `manifest.json`'s `datasetsMapping` to query this app's own dataset mapping via `domo.get`. `COLUMN_TO_ALIAS` bridges the two:

```js
var DATASET_ALIAS = 'BudgetBlindsData';

var COLUMN_TO_ALIAS = {
  'Brand': 'Brand',
  'HFCMasterID': 'HFCMasterID',
  'FranchiseName': 'Owner',       // manifest alias "Owner" -> real column "FranchiseName"
  'TerrNum': 'TerrNumName'        // manifest alias "TerrNumName" -> real column "TerrNum"
};
```

On load, `loadSelectOptionsFromDomo()` runs one `domo.get('/data/v1/BudgetBlindsData?fields=<alias>&groupby=<alias>')` per select, keeps the existing "All ..." `<option value="">`, and appends the real distinct values as new `<option>` elements (each option's `value` defaults to its text — "Two Maids" the text is also "Two Maids" the value).

Selecting an option calls:

```js
domo.filterContainer([{
  column: column,               // the raw column, e.g. "FranchiseName"
  operator: 'IN',
  values: isAllOption ? [] : [value],   // value === '' is the "All ..." option
  dataType: 'STRING'
}]);
```

`domo.filterContainer()` pushes a page-level filter that Domo applies to every *other* card on the page — same mechanism a native filter card uses. Your other charts/KPI cards don't need to live inside this app; they just need to be built on a dataset containing the filtered column (ideally `BudgetBlindsData` itself, or one related to it).

Reporting Period does the same thing with a `BETWEEN` filter on the date column:

```js
var DATE_COLUMN = 'dt';
```

MTD/QTD/YTD compute their range from today's date each time they're clicked; Custom waits until both From/To are filled in. The default MTD range is also pushed once on page load, so cards are filtered correctly before the user touches anything.

**Compare** has no dataset column — it's not something `filterContainer` can express (it's a display mode like "vs. Prior Period", not a row filter). Selecting an option stores `window.currentCompareMode` and dispatches a `compareChange` event instead:

```js
document.addEventListener('compareChange', function (e) {
  console.log('Compare mode is now', e.detail.mode);
  // hook your own comparison logic here
});
```

## Why you might still be seeing sample data

- **Most likely:** you're looking at Dev Studio's built-in code-editor preview. That preview always shows generic sample rows, regardless of `manifest.json`, until this app is added as an actual **card** on a real page and that card instance goes through its own *Select Dataset → confirm field mapping → Save & Finish* step.
- **If you've done that and it's still wrong:** open the browser console. `loadSelectOptionsFromDomo()` logs `Failed to load options for <column> from <query>` on any `domo.get` error.
- **If you're seeing the static placeholders** ("Two Maids", "Owner A", "1001", "West"/"Midwest"/"Southeast") specifically — that means `domo` was undefined when the page loaded, so `loadSelectOptionsFromDomo()` never ran at all. That points to not running inside a real Domo runtime (file opened directly, or previewed somewhere that doesn't inject `domo.js`), which is a different problem than Domo's own sample-data preview.

## The manifest.json

Domo custom apps (Dev Studio / App Framework apps, published with the `ryuu`/`domo` CLI) require a `manifest.json` at the project root.

- **id** — assigned by Domo the first time the app is created/published; don't hand-edit it.
- **name / version** — how the app design shows up in Domo.
- **size** — the default width/height (in grid units) used for local dev preview and as the card's starting size.
- **datasetsMapping** — the dataset(s) the app queries via `domo.get`, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs (see above).

### Publishing this app to Domo

This started as a **DDX Brick** but was migrated to a full **App Code** custom app (Domo will actively tell you to do this once a Brick tries to do page-wide things like `filterContainer` — Bricks are meant to be fixed, self-contained visualization components, not general nav/filter bars). The two runtimes differ in a way that matters for this code:

| | DDX Brick | App Code |
|---|---|---|
| `domo.js` | Auto-injected as `window.domo`; an explicit `<script src="domo.js">` tag 404s | A relative `<script src="domo.js">` tag **also** 404s in this app's real dashboard embed context — confirmed against the live pro-code editor. Loaded instead via CDN: `https://cdn.domo.com/domo.js/1/domo.js` + `https://unpkg.com/ryuu.js@4.6.0/dist/domo.js` |
| dataset alias | Auto-injected as `window.datasets` (array, order matches manifest mapping) | Not auto-injected, and Domo's editor flags any top-level `var datasets = [...]` as "looks migrated from a Brick" (top-level `var` becomes `window.datasets` either way) — so `app.js` just hardcodes `var DATASET_ALIAS = 'BudgetBlindsData';` instead of naming a `datasets` variable at all |

`index.html` and `app.js` in this repo are set up for **App Code** (the CDN script tags are present; the dataset alias is hardcoded rather than read off a `datasets` variable). If you ever go back to a Brick, both `<script>` tags need to come back out (Brick auto-injects `window.domo`) and the alias would come from `window.datasets[0]` instead.

The alias/column mapping is confirmed directly against **Resources → Datasets → schema** in the App Code editor: Dataset ID `f708d305-0238-4727-9fa1-80e7efa4d7d8`, alias `BudgetBlindsData`, columns `Brand→Brand`, `HFCMasterID→HFCMasterID`, `FranchiseName→Owner`, `TerrNum→TerrNumName` — matching `manifest.json` exactly, with live preview rows confirming the connection is real (not sample data).

Code still goes directly into Domo's built-in editor, not through the `ryuu`/`domo` CLI — paste in the current contents of `index.html`, `styles.css`, `app.js`, and `manifest.json` when updating.

After pasting updated code in, confirm the card's dataset binding still points at `BudgetBlindsData` and re-check the browser console for the diagnostics described above. One thing worth double-checking on your end: the dataset-mapping key in `manifest.json` was `datasetsMapping` under the Brick — App Code's manifest schema may expect a different key (older Domo custom-app docs use `mapping`). If the App Code editor shows/regenerates a different manifest shape than what's in this repo, treat its version as the source of truth and let me know what it looks like so I can update this file to match.

## Re-theming

All colors live as CSS custom properties at the top of `styles.css` (`--bar-bg`, `--accent`, etc.), so swapping the seafoam accent or gray tone is a one-line change per variable. The pill chevron is an inline SVG data URI in `.pill-select`'s `background-image` — its stroke color (`%237A8286` = `--text-label`) has to be edited there directly since CSS variables can't reach into a data URI.

## Extending

- **More dataset-driven filters:** add a field to `datasetsMapping[0].fields` in `manifest.json`, add a matching `<select class="pill-select" data-dropdown data-column="...">` block to `index.html`, and add an entry to `COLUMN_TO_ALIAS` in `app.js`.
- **A different operator than `IN`/`EQUALS`:** edit the `domo.filterContainer([...])` call inside `handleSelectChange()`.
- **Bring the caption labels back:** if a stakeholder wants explicit "Brand"/"Owner" labels over each pill instead of relying on the default option text, that's a `.filter-group`-style wrapper + `.filter-label` span per select — reintroduces the two-line-per-control height this redesign removed, so worth confirming it's actually wanted before adding it back.
