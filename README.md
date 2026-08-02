# Custom Navigation Bar — Domo App Studio

A drop-in, dependency-free navigation/filter bar for a Domo App Studio custom app.

- Subtle gray bar background
- Compact dropdown "chip" filters: **Brand**, **Master ID**, **Owner**, **Territory**
- Uppercase, small-caps filter labels (10px, letter-spaced) above each control
- **Reporting Period** segmented control: MTD / QTD / YTD / Custom (with a date-range popover for Custom)
- **Compare** dropdown
- Seafoam-green accent used for focus states, selected options, and the active period pill

## Files

```
manifest.json     Required by Domo — app metadata, size, and dataset mapping
index.html        Standalone preview/demo (open directly in a browser)
css/nav-bar.css   All nav bar styling (CSS variables at the top for easy re-theming)
js/nav-bar.js     Vanilla-JS DomoNavBar component (no dependencies)
```

## Preview it

Open `index.html` in a browser (or `python3 -m http.server` from this folder). It renders the bar with mock filter options and prints the live filter state below it as you interact.

## Integrating into your App Studio app

1. Copy `css/nav-bar.css` and `js/nav-bar.js` into your app's asset folders (or inline them into your existing `index.html`).
2. Add a mount element at the top of your app, above your existing content:
   ```html
   <div id="domo-nav-bar"></div>
   ```
3. Instantiate the bar with your real filter options (pull these from a dataset via `domo.get`, or hardcode them if they're static):
   ```js
   var navBar = new DomoNavBar("#domo-nav-bar", {
     title: "Your App Title",
     filters: [
       { id: "brand", label: "Brand", placeholder: "All Brands", defaultValue: "all", options: [...] },
       { id: "masterId", label: "Master ID", placeholder: "All IDs", defaultValue: "all", options: [...] },
       { id: "owner", label: "Owner", placeholder: "All Owners", defaultValue: "all", options: [...] },
       { id: "territory", label: "Territory", placeholder: "All Territories", defaultValue: "all", options: [...] }
     ],
     periods: ["MTD", "QTD", "YTD", "Custom"],
     defaultPeriod: "MTD",
     trailingFilters: [
       { id: "compare", label: "Compare", placeholder: "No Comparison", defaultValue: "none", options: [...] }
     ]
   });
   ```
4. React to filter changes and re-query/re-render your charts:
   ```js
   navBar.onChange(function (detail) {
     // detail.filterId  -> which control changed, e.g. "territory"
     // detail.value     -> the new value
     // detail.state     -> the full current filter state object

     domo.get('/data/v1/yourDatasetAlias?' + buildQueryFromState(detail.state))
       .then(function (rows) { renderYourCharts(rows); });
   });
   ```
   `navBar.getState()` returns the current selections at any time (e.g. on initial page load, to run your first query).

## Populating options from a live Domo dataset

`index.html` already does this end-to-end — Brand / Master ID / Owner / Territory are pulled from the `BudgetBlindsData` dataset at load time, not hardcoded. This matches the real `manifest.json` in this project:

```json
"datasetsMapping": [
  {
    "dataSetId": "f708d305-0238-4727-9fa1-80e7efa4d7d8",
    "alias": "BudgetBlindsData",
    "fields": [
      { "alias": "Brand",       "columnName": "Brand" },
      { "alias": "HFCMasterID", "columnName": "HFCMasterID" },
      { "alias": "Owner",       "columnName": "FranchiseName" },
      { "alias": "TerrNumName", "columnName": "TerrNum" }
    ],
    "dql": null
  }
]
```

The important part: each field has an **alias** (what your code queries by) and a **columnName** (the real header in the dataset). They can differ — e.g. `Owner` resolves to the actual column `FranchiseName`, `TerrNumName` resolves to `TerrNum`. That indirection is intentional: it's set from Domo's data-configuration screen when the app is added as a card, so a page owner can repoint fields at different columns later without touching this code.

`index.html` queries by the **field alias**, not the raw column name:

```js
var DATASET_ALIAS = "BudgetBlindsData"; // matches datasetsMapping[0].alias

var LIVE_FILTERS = [
  { id: "brand",     column: "Brand",       allLabel: "All Brands" },
  { id: "masterId",  column: "HFCMasterID", allLabel: "All IDs" },
  { id: "owner",     column: "Owner",       allLabel: "All Owners" },
  { id: "territory", column: "TerrNumName", allLabel: "All Territories" }
];
```

`loadLiveFilterOptions()` runs one `domo.get('/data/v1/BudgetBlindsData?fields=<alias>&groupby=<alias>')` per filter, builds an `[{label, value}, ...]` list from the distinct values in the response, and calls `navBar.setOptions(id, options)`.

This only runs when a real Domo runtime is present (`typeof domo !== "undefined"` — true inside `domo dev` and once published). Opening `index.html` directly in a plain browser still works, falling back to the small `MOCK_OPTIONS` object at the top of the script, so you can keep designing without a live dataset connection.

To add more dataset-driven filters: add a field to `datasetsMapping[0].fields` in `manifest.json` (via Domo's data-config UI, or by hand), then add a matching entry to `LIVE_FILTERS` and to the `filters` array passed to `new DomoNavBar(...)`.

**If `loadLiveFilterOptions()` comes back empty**, log the raw response once (`console.log(rows)` inside the `.then`) — if rows come back keyed by the real `columnName` instead of the `alias` on your Domo instance/version, swap `row[f.column]` to look up the column name instead.

## The manifest.json

Domo custom apps (Dev Studio / App Framework apps, published with the `ryuu`/`domo` CLI) require a `manifest.json` at the project root — the CLI won't build, preview, or publish without one.

- **id** — assigned by Domo the first time the app is created/published; don't hand-edit it.
- **name / version** — how the app design shows up in Domo.
- **size** — the default width/height (in grid units) used for local dev preview and as the card's starting size; resize after adding it to your page.
- **datasetsMapping** — the dataset(s) the app queries via `domo.get`, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs (see above). `dql` is an optional raw-query override per mapping; leave it `null` unless you need custom SQL instead of simple field/groupby queries.

### Publishing this app to Domo

```bash
npm install -g ryuu          # installs the `domo` CLI
domo login                   # authenticate to your Domo instance
domo dev                     # local dev server with live reload against this manifest.json
domo publish                 # bundles this folder and publishes the app design to Domo
```

After publishing, add the app as a card to your App Studio page and position/resize it to sit as the page header above your other content.

## Re-theming

All colors live as CSS custom properties at the top of `css/nav-bar.css` (`--dnb-bg`, `--dnb-accent`, etc.), so swapping the seafoam accent or gray tone is a one-line change per variable.
