# Claude Nav — Domo App Studio Custom Nav Bar

A drop-in navigation/filter bar for a Domo custom app, wired directly to the `BudgetBlindsData` dataset.

- Subtle gray bar background
- Dropdown filters: **Brand**, **Master ID**, **Owner**, **Territory**
- Uppercase, small-caps filter labels
- **Reporting Period** segmented control: MTD / QTD / YTD / Custom (with a From/To date popover)
- **Compare** dropdown
- Seafoam-green accent on focus, selected options, and the active period pill

## Files

```
manifest.json   Required by Domo — app metadata, size, and dataset mapping (datasetsMapping)
index.html      The nav bar markup + a placeholder content area for the rest of your page
styles.css      All nav bar styling (CSS variables at the top for easy re-theming)
app.js          Dropdown behavior, Reporting Period logic, and the domo.get/filterContainer wiring
```

## Preview it

Open `index.html` in a browser (or `python3 -m http.server` from this folder). Outside of a real Domo runtime, `domo` is undefined, so `app.js` skips every `domo.get`/`domo.filterContainer` call and just leaves the static placeholder dropdown items in place (Two Maids, Owner A, etc.) — the bar is still fully interactive for design/layout work.

## How the pieces fit together

`data-column` on each dropdown in `index.html` holds the **raw dataset column name** — `Brand`, `HFCMasterID`, `FranchiseName`, `TerrNum`. That's what `domo.filterContainer()` needs, because it's pushing a filter to *other* cards on the page, which only know real column names.

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

On load, `loadDropdownOptionsFromDomo()` runs one `domo.get('/data/v1/BudgetBlindsData?fields=<alias>&groupby=<alias>')` per dropdown, keeps the existing "All ..." item, and appends the real distinct values as new `.dropdown-item` elements.

Selecting an item calls:

```js
domo.filterContainer([{
  column: column,               // the raw column, e.g. "FranchiseName"
  operator: 'IN',
  values: isAllOption ? [] : [item.textContent],
  dataType: 'STRING'
}]);
```

`domo.filterContainer()` pushes a page-level filter that Domo applies to every *other* card on the page — same mechanism a native filter card uses. Your other charts/KPI cards don't need to live inside this app; they just need to be built on a dataset containing the filtered column (ideally `BudgetBlindsData` itself, or one related to it).

Reporting Period does the same thing with a `BETWEEN` filter on the date column:

```js
var DATE_COLUMN = 'dt';
```

MTD/QTD/YTD compute their range from today's date each time they're clicked; Custom waits until both From/To are filled in. The default MTD range is also pushed once on page load, so cards are filtered correctly before the user touches anything.

**Compare** has no dataset column — it's not something `filterContainer` can express (it's a display mode like "vs. Prior Period", not a row filter). Selecting an item stores `window.currentCompareMode` and dispatches a `compareChange` event instead:

```js
document.addEventListener('compareChange', function (e) {
  console.log('Compare mode is now', e.detail.mode);
  // hook your own comparison logic here
});
```

## Why you might still be seeing sample data

- **Most likely:** you're looking at Dev Studio's built-in code-editor preview. That preview always shows generic sample rows, regardless of `manifest.json`, until this app is added as an actual **card** on a real page and that card instance goes through its own *Select Dataset → confirm field mapping → Save & Finish* step.
- **If you've done that and it's still wrong:** open the browser console. `loadDropdownOptionsFromDomo()` logs `Failed to load options for <column> from <query>` on any `domo.get` error.
- **If you're seeing the static placeholders** ("Two Maids", "Owner A", "1001", "West"/"Midwest"/"Southeast") specifically — that means `domo` was undefined when the page loaded, so `loadDropdownOptionsFromDomo()` never ran at all. That points to not running inside a real Domo runtime (file opened directly, or previewed somewhere that doesn't inject `domo.js`), which is a different problem than Domo's own sample-data preview.

## The manifest.json

Domo custom apps (Dev Studio / App Framework apps, published with the `ryuu`/`domo` CLI) require a `manifest.json` at the project root.

- **id** — assigned by Domo the first time the app is created/published; don't hand-edit it.
- **name / version** — how the app design shows up in Domo.
- **size** — the default width/height (in grid units) used for local dev preview and as the card's starting size.
- **datasetsMapping** — the dataset(s) the app queries via `domo.get`, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs (see above).

### Publishing this app to Domo

This app is a **Domo Brick** (App Studio's pro-code component builder) — code goes directly into App Studio's built-in editor, not through the `ryuu`/`domo` CLI. To update it: open the app in App Studio's ProCode editor and paste in the current contents of `index.html`, `styles.css`, `app.js`, and `manifest.json` (the CLI publish flow described in older Domo Apps docs doesn't apply to this workflow).

A Brick's runtime exposes two globals automatically — no `<script>` tag needed for either:
- `window.domo` — `domo.get(...)` / `domo.filterContainer(...)`.
- `window.datasets` — an array of the input dataset alias(es) bound to this Brick, in the order they're defined under `manifest.json`'s `datasetsMapping`. Since there's exactly one entry here, `datasets[0]` **is** `"BudgetBlindsData"` at runtime — `app.js` uses `datasets[0]` rather than hardcoding the string, so it stays correct if the binding ever changes.

After pasting updated code in, confirm the card's dataset binding still points at `BudgetBlindsData` and re-check the browser console for the diagnostics described above.

## Re-theming

All colors live as CSS custom properties at the top of `styles.css` (`--bar-bg`, `--accent`, etc.), so swapping the seafoam accent or gray tone is a one-line change per variable.

## Extending

- **More dataset-driven filters:** add a field to `datasetsMapping[0].fields` in `manifest.json`, add a matching `data-dropdown data-column="..."` block to `index.html`, and add an entry to `COLUMN_TO_ALIAS` in `app.js`.
- **A different operator than `IN`/`EQUALS`:** edit the `domo.filterContainer([...])` call inside `wireDropdownItems()`.
