// ============================================
// DATASET WIRING
// This is a Domo App Code app (same conventions as the companion nav
// bar app). Deliberately not using a top-level `datasets` variable —
// see that app's app.js for why. Confirm this alias/dataset ID
// against Resources > Datasets > schema in the App Code editor before
// publishing, same as the nav bar.
//
// BudgetBlindsData is ~42 million rows (2024-01-01 onward) and
// growing — far too large to pull into the browser and aggregate in
// JS. An earlier version of this app tried exactly that with a
// LIMIT=100000 domo.get() call, which silently returned a
// near-arbitrary ~100k-row slice of a 42M-row table and made every
// KPI read near-zero. Every KPI below is instead computed
// server-side via a SQL aggregate query against this same dataset
// (domo.post('/sql/v1/...')), the same way a Beast Mode / native
// card gets its number — the app only ever pulls back a handful of
// already-aggregated values, never raw rows. See README for how this
// was validated against the live dataset before shipping.
// ============================================
var DATASET_ALIAS = 'BudgetBlindsData';
var DATE_COLUMN = 'dt';

// The nav bar's exact data-column values — the SQL WHERE clause built
// below is scoped to whichever of these the nav bar has selected (see
// DIMENSION FILTERING below).
// Confirmed directly against Claude Nav's own source (`domo download`)
// — its dropdowns push exactly these four data-column values via
// domo.filterContainer([{column, operator:'IN', values:[...],
// dataType:'STRING'}]). OwnerNumber is NOT one of them — that was a
// wrong guess in an earlier pass (OwnerNumber happens to also be a
// real column used by other KPIs' own distinct-count formulas above,
// which made it a plausible-looking but incorrect substitute for
// FranchiseName).
var DIMENSION_COLUMNS = ['Brand', 'HFCMasterID', 'FranchiseName', 'TerrNum'];

// ============================================
// KPI DEFINITIONS
// Four real, independently-queried KPIs — Leads, Proposals, Orders,
// Order Amount — each a straight port of its Beast Mode into SQL:
//
// - `distinctKey`: paired with COUNT(DISTINCT CASE WHEN <window> THEN
//   <key> END) in the generated SQL — the direct equivalent of a Beast
//   Mode's COUNT(DISTINCT CONCAT(...)).
// - `sumColumn`: paired with SUM(CASE WHEN <window> THEN <column> END)
//   instead.
//
// AOV and Close Rate are NOT queried directly — they're ratios of two
// of the KPIs above (Order Amount / Orders, Orders / Leads), computed
// client-side from those four queries' own per-window results. See
// deriveRatio() below.
// ============================================
var KPI_DEFS = [
  // COUNT(DISTINCT CASE WHEN Type='Leads' AND Category<>'Spend' AND
  //   <window> THEN CONCAT(OrganizationID, LeadID, MONTH(dt), YEAR(dt)) END)
  {
    id: 'Leads',
    format: 'number',
    where: "Type = 'Leads' AND Category <> 'Spend'",
    distinctKey: "CONCAT(OrganizationID,'|',LeadID,'|',MONTH(dt),'|',YEAR(dt))"
  },

  // "Proposals": COUNT(DISTINCT CASE WHEN Type='Quotes' AND
  //   quote_Number IS NOT NULL AND project_PrimaryQuote=1 AND
  //   Category<>'Spend' AND <window> THEN CONCAT(OrganizationID,
  //   OwnerNumber, quote_Number) END)
  {
    id: 'Proposals',
    format: 'number',
    where: "Type = 'Quotes' AND quote_Number IS NOT NULL AND project_PrimaryQuote = 1 AND Category <> 'Spend'",
    distinctKey: "CONCAT(OrganizationID,'|',OwnerNumber,'|',quote_Number)"
  },

  // "Order Count": COUNT(DISTINCT CASE WHEN Type='Orders' AND
  //   order_Wo IS NOT NULL AND Category<>'Spend' AND <window> THEN
  //   CONCAT(OrganizationID, OwnerNumber, order_Wo) END)
  {
    id: 'Orders',
    format: 'number',
    where: "Type = 'Orders' AND order_Wo IS NOT NULL AND Category <> 'Spend'",
    distinctKey: "CONCAT(OrganizationID,'|',OwnerNumber,'|',order_Wo)"
  },

  // "Order Amount": SUM(CASE WHEN Type='Orders' AND order_Wo IS NOT
  //   NULL AND Category<>'Spend' AND <window> THEN LineValue END)
  {
    id: 'OrderAmount',
    format: 'currency',
    where: "Type = 'Orders' AND order_Wo IS NOT NULL AND Category <> 'Spend'",
    sumColumn: 'LineValue'
  }
];

// ============================================
// SQL BUILDING
// One query per KPI covers all four windows at once (MTD, MTD-prior,
// YTD, YTD-prior) via four CASE-gated aggregate columns in a single
// SELECT — 4 queries total instead of 16, all run in parallel.
// ============================================
function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

// CAST(dt AS DATE) — dt carries a time-of-day component (rows are
// timestamped, not just dated), so a plain string BETWEEN against the
// window's [start, end] date-only bounds would silently drop same-day
// rows stamped after midnight on the end date.
function sqlDateWindow(range) {
  return "CAST(dt AS DATE) BETWEEN '" + range[0] + "' AND '" + range[1] + "'";
}

function sqlMetric(def, windowSql) {
  if (def.sumColumn) {
    return 'SUM(CASE WHEN ' + windowSql + ' THEN ' + def.sumColumn + ' END)';
  }
  return 'COUNT(DISTINCT CASE WHEN ' + windowSql + ' THEN ' + def.distinctKey + ' END)';
}

function buildKpiSql(def, ranges, dimensionWhere) {
  var windowKeys = ['mtd', 'mtdPrior', 'ytd', 'ytdPrior'];
  var selects = windowKeys.map(function (key) {
    return sqlMetric(def, sqlDateWindow(ranges[key])) + ' AS ' + key;
  }).join(', ');

  var where = def.where + (dimensionWhere ? ' AND ' + dimensionWhere : '');

  // Single-line on purpose: the per-app /sql/v1/{alias} proxy this
  // runs through (domo.post below) 500s on a SQL body containing
  // newlines, even though the exact same multi-line SQL succeeds
  // against Domo's general Dataset Query API — confirmed by bisecting
  // a failing query down to newlines as the only variable. No other
  // part of the SQL (CASE/CONCAT/COUNT DISTINCT/etc.) was the problem.
  return 'SELECT ' + selects + ' FROM table WHERE ' + where;
}

// ============================================
// QUERY EXECUTION
// domo.post('/sql/v1/{alias}', sql, {contentType:'text/plain'}) is the
// App Framework's sandboxed SQL endpoint — scoped to this app's own
// mapped dataset, authenticated automatically by the running app (no
// developer token needed in this file), and backed by the same query
// engine as a Beast Mode / native card.
// ============================================

// Normalizes either a plain array-of-row-objects response or a
// {columns, rows} response into one row object. Defensive because
// this endpoint could only be validated against the live dataset via
// the platform's general SQL execute API (same query engine, proven
// working) — not this exact App Framework proxy, which only runs
// inside a live app. If KPI cards come up blank after publishing,
// check the console: runKpiQuery logs the raw response on failure.
function firstRowAsObject(result) {
  if (!result) return {};
  if (Array.isArray(result)) return result[0] || {};
  if (result.columns && result.rows) {
    var row = result.rows[0] || [];
    var obj = {};
    result.columns.forEach(function (col, i) { obj[col] = row[i]; });
    return obj;
  }
  return {};
}

// Case-insensitive lookup — guards against the query engine folding
// SELECT ... AS aliases to a different case than written.
function pick(obj, key) {
  if (key in obj) return obj[key];
  var lower = key.toLowerCase();
  for (var k in obj) { if (k.toLowerCase() === lower) return obj[k]; }
  return null;
}

// SUM(CASE WHEN ...) over an empty window comes back SQL NULL, not 0
// — coerce to 0 to mean "no orders this window" (matches the old
// client-side aggregate() behavior). COUNT(DISTINCT ...) never
// returns NULL, so this only matters for sumColumn KPIs in practice.
function numberOrZero(value) {
  var n = Number(value);
  return value === null || value === undefined || isNaN(n) ? 0 : n;
}

function runKpiQuery(def, ranges, dimensionWhere) {
  var sql = buildKpiSql(def, ranges, dimensionWhere);

  return domo.post('/sql/v1/' + DATASET_ALIAS, sql, { contentType: 'text/plain' })
    .then(function (result) {
      var row = firstRowAsObject(result);
      return {
        mtd: numberOrZero(pick(row, 'mtd')),
        mtdPrior: numberOrZero(pick(row, 'mtdPrior')),
        ytd: numberOrZero(pick(row, 'ytd')),
        ytdPrior: numberOrZero(pick(row, 'ytdPrior'))
      };
    })
    .catch(function (err) {
      console.error('KPI query failed for ' + def.id + ':\n' + sql, err);
      return { mtd: null, mtdPrior: null, ytd: null, ytdPrior: null };
    });
}

// A ratio KPI (AOV, Close Rate) derived from two already-queried KPIs'
// own per-window results — no separate query. Mirrors the original
// Beast-Mode-as-JS compute() pattern (numerator/denominator from two
// different KPIs' row subsets), just against four numbers per KPI
// instead of four sets of rows. A zero/missing denominator yields
// null (formatValue renders that as "—", same as before).
function deriveRatio(numerator, denominator, multiplier) {
  multiplier = multiplier || 1;
  function windowRatio(key) {
    var denom = denominator[key];
    if (!denom) return null;
    return (numerator[key] / denom) * multiplier;
  }
  return {
    mtd: windowRatio('mtd'),
    mtdPrior: windowRatio('mtdPrior'),
    ytd: windowRatio('ytd'),
    ytdPrior: windowRatio('ytdPrior')
  };
}

// ============================================
// FORMATTING HELPERS
// ============================================
function formatValue(value, format) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  if (format === 'currency') {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }
  if (format === 'percent') {
    return value.toFixed(1) + '%';
  }
  return Math.round(value).toLocaleString('en-US');
}

// Delta label: percent formats/aggregates show a point difference
// ("2.2 pts") instead of a percent-of-percent, which reads oddly.
function formatDelta(current, prior, format, suffix) {
  if (prior === null || prior === undefined || current === null || current === undefined) {
    return { text: 'no prior data', direction: 'up' };
  }
  if (format === 'percent') {
    var pts = current - prior;
    return {
      text: Math.abs(pts).toFixed(1) + ' pts ' + suffix,
      direction: pts >= 0 ? 'up' : 'down'
    };
  }
  if (prior === 0) {
    return { text: 'n/a ' + suffix, direction: 'up' };
  }
  var pct = ((current - prior) / Math.abs(prior)) * 100;
  return {
    text: Math.abs(pct).toFixed(1) + '% ' + suffix,
    direction: pct >= 0 ? 'up' : 'down'
  };
}

// ============================================
// DATE RANGES
// Data is only ever loaded through yesterday, so every window below is
// anchored on yesterday, not today (see the `now` reassignment in
// getDateRanges) — otherwise MTD/YTD would tack on a same-day zero and
// every vs-last-month/vs-last-year delta would compare a partial
// "today" against a complete prior day. MTD compares this
// month-through-yesterday against the same number of days at the start
// of last month. YTD compares Jan 1-through-yesterday against the same
// Jan 1-to-same-date window last year.
// ============================================
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function getDateRanges() {
  // today - 1, via date-component arithmetic (not a raw ms subtraction)
  // so it still lands correctly across a month/year rollover — e.g. if
  // today is Sep 1 but data only goes through Aug 31, `now` below
  // (and therefore mtdStart's month/year) correctly becomes August,
  // not a same-day sliver of September.
  var today = new Date();
  var now = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  var mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  var priorMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var priorMonthDays = new Date(priorMonth.getFullYear(), priorMonth.getMonth() + 1, 0).getDate();
  var mtdPriorStart = priorMonth;
  var mtdPriorEnd = new Date(priorMonth.getFullYear(), priorMonth.getMonth(), Math.min(now.getDate(), priorMonthDays));

  var ytdStart = new Date(now.getFullYear(), 0, 1);
  var ytdPriorStart = new Date(now.getFullYear() - 1, 0, 1);
  var ytdPriorEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

  return {
    mtd: [toISODate(mtdStart), toISODate(now)],
    mtdPrior: [toISODate(mtdPriorStart), toISODate(mtdPriorEnd)],
    ytd: [toISODate(ytdStart), toISODate(now)],
    ytdPrior: [toISODate(ytdPriorStart), toISODate(ytdPriorEnd)]
  };
}

// ============================================
// RENDER
// Same data-mtd-value/data-mtd-delta/data-ytd-value/data-ytd-delta
// spans as before — renderKpi just takes a card's four already-
// computed numbers now, instead of rows + ranges to aggregate itself.
// ============================================
function renderKpi(id, format, values) {
  var card = document.querySelector('.kpi-card[data-kpi="' + id + '"]');
  if (!card) return;

  var mtdDelta = formatDelta(values.mtd, values.mtdPrior, format, 'vs last month');
  var ytdDelta = formatDelta(values.ytd, values.ytdPrior, format, 'vs last yr');

  var mtdValueEl = card.querySelector('[data-mtd-value]');
  var mtdDeltaEl = card.querySelector('[data-mtd-delta]');
  var ytdValueEl = card.querySelector('[data-ytd-value]');
  var ytdDeltaEl = card.querySelector('[data-ytd-delta]');

  if (mtdValueEl) mtdValueEl.textContent = formatValue(values.mtd, format);
  if (mtdDeltaEl) {
    mtdDeltaEl.className = 'kpi-delta ' + mtdDelta.direction;
    mtdDeltaEl.innerHTML = '<span class="arrow"></span>' + mtdDelta.text;
  }
  if (ytdValueEl) ytdValueEl.textContent = formatValue(values.ytd, format);
  if (ytdDeltaEl) {
    ytdDeltaEl.className = 'kpi-ytd-delta ' + ytdDelta.direction;
    ytdDeltaEl.innerHTML = '<span class="arrow"></span>' + ytdDelta.text;
  }
}

// Runs the four KPI queries in parallel, renders each of their cards,
// then derives + renders AOV and Close Rate from those same results.
function renderAll() {
  var ranges = getDateRanges();
  var dimensionWhere = dimensionWhereClause();

  var queries = KPI_DEFS.map(function (def) {
    return runKpiQuery(def, ranges, dimensionWhere).then(function (values) {
      return { id: def.id, format: def.format, values: values };
    });
  });

  return Promise.all(queries).then(function (results) {
    var byId = {};
    results.forEach(function (r) {
      byId[r.id] = r.values;
      renderKpi(r.id, r.format, r.values);
    });

    renderKpi('AOV', 'currency', deriveRatio(byId.OrderAmount, byId.Orders));
    renderKpi('CloseRate', 'percent', deriveRatio(byId.Orders, byId.Leads, 100));
  }).catch(function (err) {
    console.error('Failed to load KPI data', err);
  });
}

// ============================================
// DRILL-DOWN
// Temporarily inert. This used to read exact detail rows straight out
// of a client-side cache of the app's own full domo.get() pull — that
// row cache no longer exists now that every KPI is a server-side SQL
// aggregate (see DATASET WIRING above), so clicking a card's MTD/YTD
// number currently does nothing. The click handlers below stay wired
// so the rebuild is a smaller change: the plan is an on-demand SQL
// SELECT (per-KPI columns — e.g. name/lead ID/territory/date/campaign
// for Leads, quote number/date/value for Proposals — plus the current
// window + dimension filters), opened in a new browser tab as a plain
// downloadable table instead of this in-app modal.
// ============================================
var modalEl = document.getElementById('drilldownModal');

function openDrilldown(kpiId, windowKey) {
  return; // rebuild pending — see comment above
}

function closeDrilldown() {
  if (!modalEl) return;
  modalEl.classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('click', function (e) {
  var trigger = e.target.closest('[data-drill]');
  if (trigger) {
    var card = trigger.closest('.kpi-card');
    if (card) openDrilldown(card.getAttribute('data-kpi'), trigger.getAttribute('data-drill'));
    return;
  }
  if (e.target.closest('[data-modal-close]') || e.target === modalEl) {
    closeDrilldown();
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeDrilldown();
});

// ============================================
// DIMENSION FILTERING
// Brand/HFCMasterID/OwnerNumber/TerrNum selections in the nav bar
// arrive here as domo.filterContainer() payloads via
// domo.onFiltersUpdate (below) — NOT as an automatically-filtered
// query. Unlike the old client-side-cache version of this app, there's
// no in-memory row set to re-filter anymore: a dimension change means
// re-running all four SQL queries with an updated WHERE clause
// (dimensionWhereClause below), via the same renderAll() the initial
// page load calls.
//
// activeDimensionFilters holds whatever the nav bar's most recent
// domo.filterContainer() call looks like, e.g.
//   [{ column: 'Brand', operator: 'IN', values: ['Two Maids'], dataType: 'STRING' }]
// An empty `values` array means "All ..." was selected for that
// column, i.e. no restriction — dimensionWhereClause() below skips it
// entirely rather than emitting `column IN ()`, which is invalid SQL.
// Any date/period filter from the nav bar — its Reporting Period
// BETWEEN on `dt`, or any other date/period column it might push — is
// deliberately ignored here: the handler below only keeps filters
// whose column is in DIMENSION_COLUMNS (an allowlist, not just
// "not dt"), so this app's own fixed MTD/YTD windows are never
// overridden by the page's period selector no matter what column name
// or operator that selector actually uses.
// ============================================
var activeDimensionFilters = [];

function dimensionWhereClause() {
  var clauses = activeDimensionFilters
    .filter(function (f) { return f.values && f.values.length; })
    .map(function (f) {
      var values = f.values.map(function (v) { return "'" + sqlEscape(v) + "'"; }).join(',');
      return f.column + ' IN (' + values + ')';
    });
  return clauses.join(' AND ');
}

// ============================================
// LOAD
// Only runs inside a real Domo runtime — outside of Domo the static
// placeholder numbers baked into index.html stay as-is for preview.
// ============================================
if (typeof domo !== 'undefined') {
  renderAll();

  // domo.onFiltersUpdate fires whenever any card on the page (the nav
  // bar included) calls domo.filterContainer(). Re-runs all four
  // queries with the updated dimension WHERE clause — see DIMENSION
  // FILTERING above for why there's no cached row set to re-filter in
  // memory instead. If nothing filters after pasting this into Domo,
  // check the console: this logs the raw filter payload every time it
  // fires, which is the fastest way to confirm (a) the hook is firing
  // at all and (b) its shape matches what dimensionWhereClause()
  // expects (column/operator/values).
  if (typeof domo.onFiltersUpdate === 'function') {
    domo.onFiltersUpdate(function (filters) {
      console.log('KPI row received filter update:', filters);
      activeDimensionFilters = (filters || []).filter(function (f) {
        return DIMENSION_COLUMNS.indexOf(f.column) !== -1 && f.operator === 'IN';
      });
      renderAll();
    });
  } else {
    console.warn('domo.onFiltersUpdate is not available in this App Framework build — dimension filters from the nav bar will not reach this app.');
  }
}
