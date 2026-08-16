# Claude KPI Row — Domo App Studio KPI Dashboard

A drop-in row of 4-6 KPI cards for a Domo custom app, each showing an **MTD value with vs-last-month delta** and a **YTD value with vs-last-year delta**, wired directly to the `BudgetBlindsData` dataset. Built to sit on the same page as the companion **Claude Nav** app (same seafoam theme, same App Code conventions).

- 6 cards in a single row (Revenue, Leads, Jobs Booked, Close Rate, Avg Ticket, Marketing Spend by default), wrapping to 3 / 2 / 1 across as the page narrows
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
<div class="kpi-card" data-kpi="Revenue" style="--kpi-color:#5FBEA5">
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

`app.js`'s `KPI_DEFS` is the single source of truth for what each card aggregates, and each entry is one of two shapes:

```js
var KPI_DEFS = [
  // Simple column
  { id: 'Revenue', column: 'Revenue', agg: 'sum', format: 'currency' },

  // Beast-Mode-style formula
  {
    id: 'CloseRate',
    columns: ['JobsBooked', 'Leads'],
    format: 'percent',
    compute: function (rows) {
      var leads = sumCol(rows, 'Leads');
      return leads === 0 ? null : (sumCol(rows, 'JobsBooked') / leads) * 100;
    }
  }
];
```

- **Simple column** — `column` + `agg` (`'sum'` for totals like Revenue/Leads, `'avg'` for a plain row average)
- **Formula** (`compute`) — a function that receives the rows already filtered to one window (MTD, MTD-prior, YTD, or YTD-prior) and returns the number, the same shape as writing the expression in Domo's Beast Mode editor. Use the `sumCol(rows, column)` / `avgCol(rows, column)` helpers. List every column the formula reads under `columns` so `loadKpisFromDomo()` fetches them.
- `format` — `'currency'`, `'percent'`, or `'number'`, controls both the headline formatting and how deltas read (percent-format KPIs show a **point** difference, e.g. "2.2 pts", instead of a percent-of-a-percent)

### Why formulas, not just columns — and why this can't call a saved Beast Mode directly

Beast Modes are evaluated by Domo's Analyzer/query engine at the card level — they aren't part of the dataset's stored schema, so `domo.get('/data/v1/...')` (which reads raw stored columns only) has no way to invoke one, even a certified/shared Beast Mode on the same dataset. The `compute` shape above is how to get equivalent behavior: paste the Beast Mode's formula and re-express it in JS against the raw columns, once, here.

This also matters for correctness, not just plumbing: a rate like Close Rate is usually `SUM(Jobs Booked) / SUM(Leads)`, **not** an average of a stored per-row percentage column — those two are different numbers whenever row volume varies, and ratio-of-sums is what most rate-style Beast Modes actually compute. `CloseRate` and `AvgTicket` in `KPI_DEFS` are written this way as the pattern to follow for your real formulas.

On load, `loadKpisFromDomo()` runs a single query:

```
/data/v1/BudgetBlindsData?fields=dt,Revenue,Leads,JobsBooked,CloseRate,AvgTicket,MarketingSpend&limit=100000
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

**Leads** — ported directly from:

```sql
COUNT(DISTINCT CASE WHEN `Type` = 'Leads' AND `Category` <> 'Spend'
  AND `dt` < CURRENT_DATE()
  THEN CONCAT(`OrganizationID`, `LeadID`, MONTH(`dt`), YEAR(`dt`))
END)
```

This revealed `BudgetBlindsData` is transaction-level (a `Type`/`Category` column per row, not one numeric column per metric) — `filterRows` in `KPI_DEFS` replaces the `Type`/`Category` CASE conditions, `distinctKey` replaces `CONCAT(...)`, and `excludeToday: true` replaces the unconditional `dt < CURRENT_DATE()` (today is dropped from both the MTD and YTD windows). The Beast Mode's own `` `HFC Period` ``/`` `HFC From Date` ``/`` `HFC To Date` `` branching is **not** reproduced — those are Domo Variables set by native page filter controls, invisible to this app's `domo.get`, and this app's MTD/YTD windows are fixed rather than reading the page's period selector (see Drill-down above).

**Revenue / JobsBooked / CloseRate / AvgTicket / MarketingSpend** are still placeholders (simple column sums or the ratio formulas described above) — given the Leads formula's schema, JobsBooked and MarketingSpend most likely need their own `Type`/`Category`-filtered formulas rather than a dedicated numeric column. Paste those Beast Modes in and I'll port them the same way.

## Placeholder columns — update before publishing

`Revenue`, `Leads`, `JobsBooked`, `CloseRate`, `AvgTicket`, and `MarketingSpend` in `KPI_DEFS` (`app.js`) and in `manifest.json`'s `datasetsMapping[0].fields` are **placeholder column names**. Confirm the real column names against **Resources → Datasets → schema** in the App Code editor (same process the nav bar README documents) and update both files to match — otherwise every card renders `—` (no matching numeric column).

## The manifest.json

Same App Code conventions as the nav bar app — see that app's README for the full Brick-vs-App-Code writeup. Short version: `manifest.json` is required at the project root, `id` is assigned by Domo on first publish (left blank here), and `datasetsMapping` lists the dataset(s) queried via `domo.get`, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs.

Code goes directly into Domo's built-in editor, not through the `ryuu`/`domo` CLI — paste in the current contents of `index.html`, `styles.css`, `app.js`, and `manifest.json` when updating, then confirm the card's dataset binding still points at the right dataset.

## Optional: reacting to the nav bar's filters

If this app is placed on the same page as **Claude Nav**, its Reporting Period / Brand / Owner / Territory dropdowns push page-level filters via `domo.filterContainer()`. This app listens for that with `domo.onFilterUpdate()` (guarded as a no-op if the App Framework build doesn't expose it) and simply re-runs `loadKpisFromDomo()` — Domo re-scopes the `domo.get` query to the active filters automatically, so no extra wiring is needed here.

## Re-theming

All shared tokens (background, border, text, seafoam accent) live as CSS custom properties at the top of `styles.css`. Per-card accent colors are set inline via `--kpi-color` on each `.kpi-card` in `index.html`, so recoloring one KPI is a one-line change.

## Extending

- **More/fewer KPIs:** add or remove an entry in `KPI_DEFS` (`app.js`) and a matching `.kpi-card` block in `index.html`. The grid (`.kpi-row` in `styles.css`) is `repeat(6, ...)` by default — drop it to `repeat(4, ...)` / `repeat(5, ...)` if you're not using all 6 slots and want them full-width instead of leaving gaps.
- **A different comparison window** (e.g. WTD, QTD-vs-prior-quarter): add a case to `getDateRanges()` in `app.js` and a second delta line in the card markup, following the existing MTD/YTD pattern.
