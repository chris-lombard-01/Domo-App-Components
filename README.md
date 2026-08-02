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

If Brand / Master ID / Owner / Territory values should come from a dataset rather than being hardcoded, fetch distinct values on load and call `setOptions`:

```js
domo.get('/data/v1/yourDatasetAlias?fields=brand&groupby=brand').then(function (rows) {
  navBar.setOptions('brand', [
    { label: 'All Brands', value: 'all' }
  ].concat(rows.map(function (r) { return { label: r.brand, value: r.brand }; })));
});
```

## The manifest.json

Domo custom apps (Dev Studio / App Framework apps, published with the `ryuu`/`domo` CLI) require a `manifest.json` at the project root — the CLI won't build, preview, or publish without one. This project already includes one:

```json
{
  "name": "Custom Navigation Bar",
  "version": "1.0.0",
  "fullpage": true,
  "size": { "width": 12, "height": 2 },
  "mapping": [],
  "ignore": ["README.md", ".git", ".gitignore"]
}
```

- **name / version** — required; how the app design shows up in Domo.
- **fullpage** — lets the app stretch to fill its container's width, appropriate for a bar meant to span the top of a page rather than sit in a fixed-size card.
- **size** — the default width/height (in grid units) used for local dev preview; resize the card after adding it to your page.
- **mapping** — dataset aliases the app queries via `domo.get`. It's empty here because the filter options are currently mocked in `index.html`. If you wire the dropdowns to a live dataset (see "Populating options from a live Domo dataset" below), add an entry: `{ "alias": "yourAlias", "dataSetId": "<dataset-guid>", "fields": [] }`.
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
