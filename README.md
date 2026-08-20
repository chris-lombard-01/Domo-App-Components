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
app.js          KPI SQL definitions, MTD/YTD date math, and the domo.post wiring
thumbnail.png   300x300 app icon (required by Domo for card/App Store representation)
```

## Preview it

Open `index.html` in a browser (or `python3 -m http.server` from this folder). Outside of a real Domo runtime, `domo` is undefined, so `app.js` skips its `domo.post` calls and leaves the placeholder numbers already baked into `index.html` in place — the row is still fully styled and responsive for design/layout work.

## Why this is SQL, not raw rows in JS

`BudgetBlindsData` is **~42 million rows** (2024-01-01 onward, and growing) — 11+ million of those in this year's YTD window alone. An earlier version of this app pulled raw rows into the browser with `domo.get('/data/v1/BudgetBlindsData?...&limit=100000')` and aggregated them client-side in JS, the same way you'd write a Beast Mode formula out longhand. That works fine at thousands of rows, but at this dataset's real scale a 100,000-row `LIMIT` silently returns a near-arbitrary sliver of the table (not sorted toward recent dates), so every KPI read near-zero — MTD/YTD numbers didn't remotely match the native Beast Mode cards on the same page, which aggregate server-side over the full dataset.

The fix: every KPI now runs as a **server-side SQL aggregate query** against the same dataset, via `domo.post('/sql/v1/{alias}', sql, {contentType:'text/plain'})` — the App Framework's sandboxed SQL endpoint, scoped to this app's own mapped dataset and authenticated automatically (no developer token embedded in this file). This is the same query engine a Beast Mode / native card uses; the app only ever pulls back a handful of already-aggregated numbers, never raw rows. Each KPI's SQL was hand-validated against the live dataset (via Domo's general Dataset Query API, `POST /api/query/v1/execute/{datasetId}`, using a developer token, outside the app) before being ported into `app.js`, confirming real non-zero totals at the right order of magnitude before shipping.

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

- `data-kpi` matches an `id` used in `app.js` (either a `KPI_DEFS` entry's `id`, or `'AOV'`/`'CloseRate'` for the two derived cards)
- `--kpi-color` (inline style) tints that card's icon chip and top accent bar — independent of the metric it represents, so palette changes are a one-line edit per card
- `data-mtd-value` / `data-mtd-delta` / `data-ytd-value` / `data-ytd-delta` are the four spans `app.js` overwrites once real numbers load

`app.js`'s `KPI_DEFS` array holds the **four independently-queried** KPIs — Leads, Proposals, Orders, Order Amount. Each entry is a straight port of its Beast Mode into SQL:

- `where` — the Beast Mode's `CASE WHEN <conditions>`, as a plain SQL `WHERE` clause (e.g. `"Type = 'Orders' AND order_Wo IS NOT NULL AND Category <> 'Spend'"`)
- `distinctKey` — the Beast Mode's `CONCAT(...)` dedup key, paired with `COUNT(DISTINCT CASE WHEN <window> THEN <key> END)` in the generated SQL
- **or** `sumColumn` — a plain column name, paired with `SUM(CASE WHEN <window> THEN <column> END)` instead
- `format` — `'currency'`, `'percent'`, or `'number'`; controls both the headline formatting and how deltas read (percent-format KPIs show a **point** difference, e.g. "2.2 pts", instead of a percent-of-a-percent)

Example (Proposals, a `COUNT(DISTINCT ...)`):

```js
{
  id: 'Proposals',
  format: 'number',
  where: "Type = 'Quotes' AND quote_Number IS NOT NULL AND project_PrimaryQuote = 1 AND Category <> 'Spend'",
  distinctKey: "CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number)"
}
```

`buildKpiSql()` turns one of these into a single query covering **all four windows at once** (MTD, MTD-prior, YTD, YTD-prior), via four CASE-gated aggregate columns in one `SELECT` — e.g. Proposals becomes:

```sql
SELECT
  COUNT(DISTINCT CASE WHEN CAST(dt AS DATE) BETWEEN '2026-08-01' AND '2026-08-19' THEN CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number) END) AS mtd,
  COUNT(DISTINCT CASE WHEN CAST(dt AS DATE) BETWEEN '2026-07-01' AND '2026-07-19' THEN CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number) END) AS mtdPrior,
  COUNT(DISTINCT CASE WHEN CAST(dt AS DATE) BETWEEN '2026-01-01' AND '2026-08-19' THEN CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number) END) AS ytd,
  COUNT(DISTINCT CASE WHEN CAST(dt AS DATE) BETWEEN '2025-01-01' AND '2025-08-19' THEN CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number) END) AS ytdPrior
FROM table
WHERE Type = 'Quotes' AND quote_Number IS NOT NULL AND project_PrimaryQuote = 1 AND Category <> 'Spend'
```

4 queries total (one per KPI), run in parallel via `Promise.all` — not 16 (4 KPIs × 4 windows), and nowhere close to 16 for AOV/Close Rate either, since those don't query at all.

**AOV and Close Rate are not queried directly.** They're ratios of two of the four KPIs above's own per-window results — `deriveRatio(numerator, denominator, multiplier)` divides one KPI's `{mtd, mtdPrior, ytd, ytdPrior}` by another's, entirely client-side, the same relationship the original Beast Modes describe ("Order Amount Sum / Orders Count", "Orders / Leads"):

```js
renderKpi('AOV', 'currency', deriveRatio(byId.OrderAmount, byId.Orders));
renderKpi('CloseRate', 'percent', deriveRatio(byId.Orders, byId.Leads, 100));
```

### `CAST(dt AS DATE)`

`dt` carries a time-of-day component (rows are timestamped, not just dated). A plain string `BETWEEN` against a window's date-only bounds would silently drop same-day rows stamped after midnight on the end date — every window comparison in `sqlDateWindow()` casts `dt` to a bare date first to avoid that.

## Date ranges

Every window is anchored on **yesterday**, not today — the dataset is only ever loaded through yesterday, so ending a window on today would tack on a same-day zero and skew every delta against a complete prior period. `getDateRanges()` computes `now` as `today - 1` via date-component arithmetic (not a raw ms subtraction), so it still lands correctly across a month/year rollover — e.g. if today is Sep 1 but data only goes through Aug 31, MTD correctly stays anchored to August rather than a same-day sliver of September.

| Window | Range |
|---|---|
| MTD | 1st of this month → yesterday |
| MTD prior | 1st of last month → same day-of-month last month |
| YTD | Jan 1 this year → yesterday |
| YTD prior | Jan 1 last year → same month/day last year |

## Drill-down (temporarily inert — next up)

Every MTD/YTD number is still a clickable button in the markup, but clicking one currently does nothing. The old version of this app cached exact detail rows in memory as a side effect of its full `domo.get()` pull, so a click could show them instantly with no extra fetch; that row cache doesn't exist anymore now that every KPI is a server-side aggregate (see "Why this is SQL, not raw rows in JS" above).

Planned rebuild: an on-demand SQL `SELECT` when a user actually clicks a number, scoped to that KPI's own filter + the clicked window + current dimension filters, opened in a **new browser tab as a plain table** (not the in-app modal) so it's easy to select-all/copy or save. Per-KPI columns, not a generic dump:

- **Leads**: name, lead ID, territory number, date, marketing campaign
- **Proposals**: quote number, date, value, etc.

The modal markup/CSS (`#drilldownModal` in `index.html`) and the click-handler wiring in `app.js` are left in place since the new-tab version will likely still want the "Filter page to this view" `domo.filterContainer()` behavior — just retargeted to open a table instead of populating the modal.

## Real Beast Modes ported so far

The row is a full funnel — **Leads → Proposals → Orders → Order Amount**, plus **AOV** and **Close Rate** as derived ratios — and every card is a real formula, not a placeholder:

| Card | Ported from |
|---|---|
| **Leads** | `COUNT(DISTINCT CASE WHEN Type='Leads' AND Category<>'Spend' AND dt<CURRENT_DATE() THEN CONCAT(OrganizationID, LeadID, MONTH(dt), YEAR(dt)) END)` |
| **Proposals** | `COUNT(DISTINCT CASE WHEN Type='Quotes' AND quote_Number IS NOT NULL AND project_PrimaryQuote=1 AND Category<>'Spend' THEN CONCAT(OrganizationID, OwnerNumber, quote_Number) END)` |
| **Orders** | "Order Count": `COUNT(DISTINCT CASE WHEN Reporting Period Flag=1 AND Type='Orders' AND order_Wo IS NOT NULL AND Category<>'Spend' THEN CONCAT(OrganizationID, OwnerNumber, order_Wo) END)` |
| **Order Amount** | `SUM(CASE WHEN Type='Orders' AND order_Wo IS NOT NULL AND Category<>'Spend' THEN LineValue END)` |
| **AOV** | "Order Amount Sum / Orders Count" — Order Amount's formula above, divided by Orders' distinct count |
| **Close Rate** | Not a provided Beast Mode — this app's own placeholder ratio, Orders / Leads, built from the two real distinct-count formulas above instead of a fabricated column |

This confirmed `BudgetBlindsData` is transaction-level (`Type`/`Category` per row, e.g. `Type` taking values like `Leads`/`Quotes`/`Orders`), which is why every card is a `WHERE`-filtered `COUNT(DISTINCT ...)`/`SUM(...)` rather than reading a dedicated numeric column.

Two things dropped in translation, both intentionally:

- **`dt < CURRENT_DATE()`** (Leads) — superseded by every window in this app already ending on yesterday (see Date ranges above), which excludes real "today" for every card, not just Leads.
- **`` `HFC Period` `` / `` `HFC From Date` `` / `` `HFC To Date` `` (Leads) and `` `Reporting Period Flag` `` (Orders)** — dropped entirely. Both are how the production Beast Modes get their date window from Domo Variables set by the page's native filter controls. This app's own fixed MTD-vs-last-month / YTD-vs-last-year `dt` windows do that job instead (see Reacting to the nav bar's filters below for why this app doesn't read the nav bar's period selector).

If any of these numbers don't match their source Beast Mode once live, the `Reporting Period Flag` drop on Orders is the most likely place to check first — it may be filtering out rows this app's own date window doesn't.

## The manifest.json

Same App Code conventions as the nav bar app — see that app's README for the full Brick-vs-App-Code writeup. Short version: `manifest.json` is required at the project root, `id` identifies the specific published app in this Domo instance (once assigned, keep it — it's what makes `domo publish` update the existing app instead of creating a new one), and `datasetsMapping` lists the dataset(s) this app can query, keyed by `alias`, with a `fields` array of `{alias, columnName}` pairs.

This app is published via the **Domo CLI** (`ryuu`, installed globally as the `domo` command): `domo login -t <developer-token>` once per machine, then `domo publish` from this folder pushes `index.html`/`styles.css`/`app.js`/`manifest.json`/`thumbnail.png` straight to the existing app in Domo — no copy/paste into the App Studio code editor needed. `domo ls` lists every published design in the instance if you need to confirm an app's `id`.

## Reacting to the nav bar's filters

If this app is placed on the same page as **Claude Nav**, selecting a Brand/Master ID/Franchise Name/Territory scopes every KPI's numbers to that selection. This does **not** happen automatically — a `domo.post` SQL query only ever reflects whatever `WHERE` clause this app builds itself, so this app has to turn the nav bar's filter into SQL on every change:

1. `domo.onFiltersUpdate()` fires whenever any card on the page — the nav bar included — calls `domo.filterContainer()`. The handler keeps only `IN`-operator filters whose column is in `DIMENSION_COLUMNS` (`Brand`, `HFCMasterID`, `FranchiseName`, `TerrNum` — confirmed directly against Claude Nav's own source via `domo download`, not guessed) — an allowlist, not just "not `dt`" — so any date/period filter the nav bar pushes (its Reporting Period `BETWEEN` on `dt`, or anything else date-related under a different column name) is dropped rather than accidentally treated as a dimension filter. Kept filters are stored as `activeDimensionFilters`.

   An earlier pass here had `OwnerNumber` in this list instead of `FranchiseName` — a plausible-looking but wrong guess (`OwnerNumber` is a real column, just not one of the nav bar's filters; it's used by other KPIs' own distinct-count formulas above). If dimension filtering seems to silently not apply again in the future, `domo download -i <design-id> -d <version>` against Claude Nav is the fastest way to confirm its actual `data-column` values first-hand instead of guessing from this dataset's other column names.
2. `dimensionWhereClause()` turns `activeDimensionFilters` into a SQL `AND`-joined set of `column IN ('a','b')` clauses — an empty `values` array means "All ..." was selected for that column (no restriction), so that column is skipped entirely rather than emitting invalid `column IN ()` SQL.
3. Every `onFiltersUpdate` firing calls `renderAll()` again, which re-runs all four KPI queries with the updated `WHERE` clause — there's no cached row set to re-filter in memory the way the old version did, so a dimension change means a fresh (small, fast) round of aggregate queries rather than an instant in-memory re-filter.

If nothing filters after pasting this into Domo, open the console: every `onFiltersUpdate` firing logs the raw payload it received, which is the fastest way to tell whether the hook isn't firing at all (nothing logs) vs. firing with a shape `dimensionWhereClause()` doesn't expect (logs, but check the `column`/`operator`/`values` keys against what it's matching on).

Note the plural: it's `domo.onFiltersUpdate`, **not** `onFilterUpdate` — several official-looking doc sources reference the singular name, but this App Studio build's actual `domo` object only exposes the plural one (confirmed by running `Object.keys(domo)` in the app's own iframe console context — DevTools defaults to the top-level page's console, so switch the console's frame context to the app's own subdomain first, or `domo` won't be defined at all). Calling the wrong name doesn't error — it just silently never registers the listener, logging `domo.onFiltersUpdate is not available in this App Framework build` instead, which looks identical to "this build doesn't support cross-widget filters" unless you check the exact spelling.

**Second gotcha, found the same way (live console logging, not docs):** the filter object actually delivered to `onFiltersUpdate` uses `operand`, not `operator`, e.g. `{column:'HFCMasterID', operand:'IN', values:['HFC000000298'], dataType:'string', dataSourceId:'...', aggregated:false, sourceCardURN:..., persist:true, label:'HFCMasterID', alias:null}` — even though Claude Nav's own `domo.filterContainer()` call pushes `operator:'IN'`. App Studio evidently renames/rewrites the filter object somewhere between push and delivery (also lowercasing `dataType` and adding several extra fields). The dimension-filter handler checks both `f.operand === 'IN'` and `f.operator === 'IN'` as cheap insurance against that renaming being inconsistent across filter sources. `app.js` logs the filter payload, the built `dimensionWhere`, every KPI's generated SQL, and every KPI's result on each render specifically so a future platform quirk like this shows up in one console dump instead of several rounds of guessing.

## Re-theming

All shared tokens (background, border, text, seafoam accent) live as CSS custom properties at the top of `styles.css`. Per-card accent colors are set inline via `--kpi-color` on each `.kpi-card` in `index.html`, so recoloring one KPI is a one-line change.

## Extending

- **More/fewer KPIs:** add or remove an entry in `KPI_DEFS` (`app.js`) and a matching `.kpi-card` block in `index.html`. The grid (`.kpi-row` in `styles.css`) is `repeat(6, ...)` by default — drop it to `repeat(4, ...)` / `repeat(5, ...)` if you're not using all 6 slots and want them full-width instead of leaving gaps.
- **A different comparison window** (e.g. WTD, QTD-vs-prior-quarter): add a case to `getDateRanges()` in `app.js` and a second delta line in the card markup, following the existing MTD/YTD pattern.
