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

## Re-theming

All colors live as CSS custom properties at the top of `css/nav-bar.css` (`--dnb-bg`, `--dnb-accent`, etc.), so swapping the seafoam accent or gray tone is a one-line change per variable.
