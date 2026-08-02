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

`index.html` already does this end-to-end — Brand / Master ID / Owner / Territory are no longer hardcoded, they're pulled from a dataset at load time. To point it at your real data:

1. **Find your dataset's ID** — open the dataset in Domo's Data Center; the ID is the GUID in the page URL.
2. **Add it to `manifest.json`**, under `mapping` (already scaffolded):
   ```json
   "mapping": [
     { "alias": "filterData", "dataSetId": "<your-dataset-guid>", "fields": [] }
   ]
   ```
   `filterData` is just a name your code uses to refer to this dataset — it doesn't need to match anything in Domo. This `dataSetId` is what `domo dev` proxies against locally; once the app is published and added to a page, Domo's card-setup screen ("Select Dataset") is what actually binds the alias to a real dataset, so point it at the same one there.
3. **Match the column names**, in `index.html`:
   ```js
   var DATASET_ALIAS = "filterData"; // must match manifest.json's alias

   var LIVE_FILTERS = [
     { id: "brand",     column: "Brand",     allLabel: "All Brands" },
     { id: "masterId",  column: "Master ID", allLabel: "All IDs" },
     { id: "owner",     column: "Owner",     allLabel: "All Owners" },
     { id: "territory", column: "Territory", allLabel: "All Territories" }
   ];
   ```
   Change each `column` value to the exact (case-sensitive) column header in your dataset.
4. That's it — `loadLiveFilterOptions()` runs one `domo.get('/data/v1/filterData?fields=...&groupby=...')` per filter, builds an `[{label, value}, ...]` list from the distinct values, and calls `navBar.setOptions(id, options)`.

This only runs when a real Domo runtime is present (`typeof domo !== "undefined"` — true inside `domo dev` and once published). Opening `index.html` directly in a plain browser still works, falling back to the small `MOCK_OPTIONS` object at the top of the script, so you can keep designing without needing a live dataset connection.

Add more dataset-driven filters the same way: add an entry to `LIVE_FILTERS` and a matching filter definition in the `filters` array passed to `new DomoNavBar(...)`.

## The manifest.json

Domo custom apps (Dev Studio / App Framework apps, published with the `ryuu`/`domo` CLI) require a `manifest.json` at the project root — the CLI won't build, preview, or publish without one. This project already includes one:

```json
{
  "name": "Custom Navigation Bar",
  "version": "1.0.0",
  "fullpage": true,
  "size": { "width": 12, "height": 2 },
  "mapping": [
    { "alias": "filterData", "dataSetId": "PUT-YOUR-DATASET-ID-HERE", "fields": [] }
  ],
  "ignore": ["README.md", ".git", ".gitignore"]
}
```

- **name / version** — required; how the app design shows up in Domo.
- **fullpage** — lets the app stretch to fill its container's width, appropriate for a bar meant to span the top of a page rather than sit in a fixed-size card.
- **size** — the default width/height (in grid units) used for local dev preview; resize the card after adding it to your page.
- **mapping** — dataset aliases the app queries via `domo.get`. Replace `PUT-YOUR-DATASET-ID-HERE` with your real dataset's GUID — see "Populating options from a live Domo dataset" below for the full hookup.
- **id** — intentionally omitted; the CLI injects it automatically into `manifest.json` the first time you publish. Don't hand-write one.

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
