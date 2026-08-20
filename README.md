# Claude KPI Row — Domo App Studio KPI Dashboard

A drop-in row of 4-6 KPI cards for a Domo custom app, each showing an **MTD value with vs-last-month delta** and a **YTD value with vs-last-year delta**, wired directly to the `BudgetBlindsData` dataset. Built to sit on the same page as the companion **Claude Nav** app (same seafoam theme, same App Code conventions).

- 6 cards in a single row — a full funnel: Leads → Proposals → Orders → Order Amount, plus AOV and Close Rate — wrapping to 3 / 2 / 1 across as the page narrows
- Each card gets its own accent color as a top bar + tinted icon chip, so a metric is identifiable before you've read the title
- Big MTD number with a green/red delta pill vs. the same number of days last month
- Smaller YTD line below a divider, with its own delta vs. the same Jan 1-to-date window last year
- All colors/spacing live as CSS custom properties for easy re-theming

## Files

```
manifest.json   Required by Domo — app metadata, size, and dataset mapping (datasetsMapping)
index.html      The 6 KPI cards + preview placeholder numbers
styles.css      All card styling (CSS variables at the top for easy re-theming)
app.js          KPI definitions, MTD/YTD math, and the domo.get wiring
```

## Preview it

Open `index.html` in a browser (or `python3 -m http.server` from this folder). Outside of a real Domo runtime, `domo` is undefined, so `app.js` skips its `domo.get` call and leaves the placeholder numbers already baked into `index.html` in place — the row is still fully styled and responsive for design/layout work.

## How the pieces fit together

Each card in `index.html` is a `.kpi-card` with:

```html
<div class="kpi-card" data-kpi="OrderAmount" style="--kpi-color:#5FBEA5">
  ...
  <div class="kpi-value" data-mtd-value>$128,400</div>
  <div class="kpi-delta up" data-mtd-delta>...</div>
  ...
  <span class="kpi-ytd-value" data-ytd-value>$942,100</span>
  <span class="kpi-ytd-delta up" data-ytd-delta>...</span>
</div>
```

- `data-kpi` matches an `id` in `app.js`'s `KPI_DEFS` array
- `--kpi-color` (inline style) tints that card's icon chip and top accent bar — independent of the metric it represents, so palette changes are a one-line edit per card
- `data-mtd-value` / `data-mtd-delta` / `data-ytd-value` / `data-ytd-delta` are the four spans `app.js` overwrites once real numbers load

`app.js`'s `KPI_DEFS` is the single source of truth for what each card aggregates. Every entry can carry:

- `filterRows(rows)` — replaces a Beast Mode's `CASE WHEN <conditions>` (e.g. `Type='Leads' AND Category<>'Spend'`), narrowing the window's rows down before aggregation
- either `column` + `agg` (`'sum'`/`'avg'`, for a plain `SUM(...)`/`AVG(...)`) **or** `compute(rows, def)` (for anything a Beast Mode expresses as `COUNT(DISTINCT ...)` or a ratio between two different row subsets)
- `distinctKey(row)` — replaces a Beast Mode's `CONCAT(...)` dedup key, paired with the `distinctCount(rows, keyFn)` helper for `COUNT(DISTINCT ...)`
- `excludeToday: true` — replaces an unconditional `dt < CURRENT_DATE()`
- `format` — `'currency'`, `'percent'`, or `'number'`; controls both the headline formatting and how deltas read (percent-format KPIs show a **point** difference, e.g. "2.2 pts", instead of a percent-of-a-percent)

Example (Proposals, a `COUNT(DISTINCT ...)`):

```js
{
  id: 'Proposals',
  columns: ['Type', 'quote_Number', 'project_PrimaryQuote', 'Category', 'OrganizationID', 'OwnerNumber'],
  format: 'number',
  filterRows: function (rows) {
    return rows.filter(function (r) {
      return r.Type === 'Quotes' && r.quote_Number != null &&
        Number(r.project_PrimaryQuote) === 1 && r.Category !== 'Spend';
    });
  },
  distinctKey: function (row) {
    return [row.OrganizationID, row.OwnerNumber, row.quote_Number].join('|');
  },
  compute: function (rows, def) { return distinctCount(rows, def.distinctKey); }
}
```

A KPI that's a ratio between two *different* row subsets (AOV, Close Rate) skips its own `filterRows` and instead calls another KPI def's `filterRows`/`distinctKey` directly inside `compute` — see `AOV` and `CloseRate` in `app.js`, which reuse `ORDER_AMOUNT_DEF`/`ORDERS_DEF`/`LEADS_DEF` this way rather than duplicating each definition.

### Why formulas, not just columns — and why this can't call a saved Beast Mode directly

Beast Modes are evaluated by Domo's Analyzer/query engine at the card level — they aren't part of the dataset's stored schema, so `domo.get('/data/v1/...')` (which reads raw stored columns only) has no way to invoke one, even a certified/shared Beast Mode on the same dataset. `filterRows`/`compute`/`distinctKey` above is how to get equivalent behavior: paste the Beast Mode's formula and re-express it in JS against the raw columns, once, here.

This also matters for correctness, not just plumbing: a rate like Close Rate is `SUM`/`COUNT` of totals, **not** an average of a stored per-row percentage column — those two are different numbers whenever row volume varies, and ratio-of-totals is what every rate-style formula in this dataset actually computes (confirmed directly by the AOV formula: "Orders Sum / Orders Count", not an average of a stored AOV column).

On load, `loadKpisFromDomo()` runs a single query for the union of every KPI's `columns`:

```
/data/v1/BudgetBlindsData?fields=dt,Type,LineValue,Category,OrganizationID,LeadID,OwnerNumber,quote_Number,project_PrimaryQuote,order_Wo&limit=100000
```

and computes all four date windows client-side per KPI:

| Window | Range |
|---|---|
| MTD | 1st of this month → today |
| MTD prior | 1st of last month → same day-of-month last month |
| YTD | Jan 1 this year → today |
| YTD prior | Jan 1 last year → same month/day last year |

## Drill-down

Every MTD and YTD number is a button. Clicking one opens an in-app panel listing the exact detail rows behind that number — no extra `domo.get`, since `renderKpi()` caches each window's filtered rows in `kpiRowCache` as it computes the headline. The panel also has a **Filter page to this view** button that pushes the same date range (plus any KPI-specific filters, via an optional `drillFilters()` on the KPI def) through `domo.filterContainer()`, so other native Domo cards on the same Studio page drill to the same slice too. That button is hidden automatically outside a real Domo runtime.

This app intentionally does **not** react to the nav bar's period selector — MTD-vs-last-month and YTD-vs-last-year are fixed, matching how the Beast Modes below are written. If that changes, the fix is a `domo.onFilterUpdate` listener (App Framework's cross-card filter hook, already stubbed in `app.js`) reading the nav bar's pushed `dt` range instead of computing one internally.

## Real Beast Modes ported so far

The row is now a full funnel — **Leads → Proposals → Orders → Order Amount**, plus **AOV** and **Close Rate** as derived ratios — and every card is a real formula, not a placeholder:

| Card | Ported from |
|---|---|
| **Leads** | `COUNT(DISTINCT CASE WHEN Type='Leads' AND Category<>'Spend' AND dt<CURRENT_DATE() THEN CONCAT(OrganizationID, LeadID, MONTH(dt), YEAR(dt)) END)` |
| **Proposals** | `COUNT(DISTINCT CASE WHEN Type='Quotes' AND quote_Number IS NOT NULL AND project_PrimaryQuote=1 AND Category<>'Spend' THEN CONCAT(OrganizationID, OwnerNumber, quote_Number) END)` |
| **Orders** | "Order Count": `COUNT(DISTINCT CASE WHEN Reporting Period Flag=1 AND Type='Orders' AND order_Wo IS NOT NULL AND Category<>'Spend' THEN CONCAT(OrganizationID, OwnerNumber, order_Wo) END)` |
| **Order Amount** | `SUM(CASE WHEN Type='Orders' AND order_Wo IS NOT NULL AND Category<>'Spend' THEN LineValue END)` |
| **AOV** | "Order Amount Sum / Orders Count" — Order Amount's formula above, divided by Orders' distinct count |
| **Close Rate** | Not a provided Beast Mode — this app's own placeholder ratio, Orders / Leads, now built from the two real distinct-count formulas above instead of a fabricated column |

This confirmed `BudgetBlindsData` is transaction-level (`Type`/`Category` per row, e.g. `Type` taking values like `Leads`/`Quotes`/`Orders`), which is why every card uses `filterRows`/`distinctKey` instead of reading a dedicated numeric column.

Two things dropped in translation, both intentionally:

- **`dt < CURRENT_DATE()`** (Leads) → `excludeToday: true`, dropping today from both the MTD and YTD windows for that card.
- **`` `HFC Period` `` / `` `HFC From Date` `` / `` `HFC To Date` `` (Leads) and `` `Reporting Period Flag` `` (Orders)** → dropped entirely. Both are how the production Beast Modes get their date window from Domo Variables set by the page's native filter controls — invisible to this app's `domo.get`. This app's own fixed MTD-vs-last-month / YTD-vs-last-year `dt` windows do that job instead (see Drill-down above for why this app doesn't read the nav bar's period selector).

If any of these numbers don't match their source Beast Mode once live, the `Reporting Period Flag` drop on Orders is the most likely place to check first — it may be filtering out rows this app's own date window doesn't.

## The manifest.json

Same App Code conventions as the nav bar app — see that app's README for the full Brick-vs-App-Code writeup. Short version: `manifest.json` is required at the project root, `id` is assigned by Domo on first publish (left blank here), and `datasetsMapping` lists the dataset(s) queried via `domo.get`, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs.

Code goes directly into Domo's built-in editor, not through the `ryuu`/`domo` CLI — paste in the current contents of `index.html`, `styles.css`, `app.js`, and `manifest.json` when updating, then confirm the card's dataset binding still points at the right dataset.

## Reacting to the nav bar's filters

If this app is placed on the same page as **Claude Nav**, selecting a Brand/Master ID/Owner/Territory scopes every KPI's numbers to that selection. This does **not** happen automatically — `domo.get()` here always queries the full unfiltered dataset regardless of what other cards on the page have filtered, so this app has to apply the nav bar's filter itself:

1. `DIMENSION_COLUMNS` (`Brand`, `HFCMasterID`, `OwnerNumber`, `TerrNum` — the nav bar's exact `data-column` values) are fetched alongside every KPI's own columns in the one `domo.get()` call, and the raw rows are cached in `cachedRows`.
2. `domo.onFilterUpdate()` fires whenever any card on the page — the nav bar included — calls `domo.filterContainer()`. The handler keeps only `IN`-operator filters whose column is in `DIMENSION_COLUMNS` — an allowlist, not just "not `dt`" — so any date/period filter the nav bar pushes (its Reporting Period `BETWEEN` on `dt`, or anything else date-related under a different column name) is dropped rather than accidentally treated as a dimension filter. See Drill-down above for why this app keeps its own fixed MTD/YTD windows instead of following the page's period selector. Kept filters are stored as `activeDimensionFilters`.
3. `renderAll()` runs `cachedRows` through `applyDimensionFilters()` — an empty `values` array means "All ..." was selected for that column (no restriction) — before computing any KPI, so a Brand/Owner/etc. selection re-scopes every card without a new `domo.get()` call.

If nothing filters after pasting this into Domo, open the console: every `onFilterUpdate` firing logs the raw payload it received, which is the fastest way to tell whether the hook isn't firing at all (nothing logs) vs. firing with a shape `applyDimensionFilters()` doesn't expect (logs, but check the `column`/`operator`/`values` keys against what it's matching on).

## Re-theming

All shared tokens (background, border, text, seafoam accent) live as CSS custom properties at the top of `styles.css`. Per-card accent colors are set inline via `--kpi-color` on each `.kpi-card` in `index.html`, so recoloring one KPI is a one-line change.

## Extending

- **More/fewer KPIs:** add or remove an entry in `KPI_DEFS` (`app.js`) and a matching `.kpi-card` block in `index.html`. The grid (`.kpi-row` in `styles.css`) is `repeat(6, ...)` by default — drop it to `repeat(4, ...)` / `repeat(5, ...)` if you're not using all 6 slots and want them full-width instead of leaving gaps.
- **A different comparison window** (e.g. WTD, QTD-vs-prior-quarter): add a case to `getDateRanges()` in `app.js` and a second delta line in the card markup, following the existing MTD/YTD pattern.
