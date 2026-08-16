// ============================================
// DATASET WIRING
// This is a Domo App Code app (same conventions as the companion nav
// bar app). Deliberately not using a top-level `datasets` variable —
// see that app's app.js for why. Confirm this alias/dataset ID
// against Resources > Datasets > schema in the App Code editor before
// publishing, same as the nav bar.
// ============================================
var DATASET_ALIAS = 'BudgetBlindsData';
var DATE_COLUMN = 'dt';

// ============================================
// KPI DEFINITIONS
// Two shapes, mirroring how Domo Beast Modes work (they're not
// reachable from this app's domo.get call directly — see README —
// so the same math has to be re-expressed here):
//
// 1. Simple column: { column, agg } — 'sum' for totals (Revenue,
//    Leads), 'avg' for a plain row-average.
// 2. Beast-Mode-style formula: { compute } — a function that takes
//    the already-date-filtered rows for one window (MTD, MTD-prior,
//    YTD, or YTD-prior) and returns the number, same as you'd write
//    the formula in Domo's Beast Mode editor. Use sumCol()/avgCol()
//    as helpers. Prefer this whenever the real Beast Mode is a ratio
//    (e.g. SUM(Jobs Booked) / SUM(Leads)) rather than a stored rate
//    column — averaging a per-row percentage is usually NOT the same
//    number as the ratio of totals, and ratio-of-sums is what most
//    rate Beast Modes actually compute.
//
// `format` controls how numbers/deltas render. Add/remove entries
// here to change which KPIs show — keep index.html's data-kpi values
// in sync (each needs a matching .kpi-card with data-mtd-value/
// data-mtd-delta/data-ytd-value/data-ytd-delta spans).
//
// IMPORTANT: Revenue/Leads/JobsBooked/AvgTicket/MarketingSpend are
// placeholder column names — swap them for the real columns in
// BudgetBlindsData (or whatever dataset this app is bound to) and
// update manifest.json's datasetsMapping fields to match. Then port
// your actual Beast Mode formulas into `compute` functions below —
// paste the Beast Mode expressions and I'll translate them 1:1.
// ============================================
var KPI_DEFS = [
  { id: 'Revenue',        column: 'Revenue',        agg: 'sum', format: 'currency' },
  { id: 'Leads',          column: 'Leads',           agg: 'sum', format: 'number'   },
  { id: 'JobsBooked',     column: 'JobsBooked',      agg: 'sum', format: 'number'   },
  {
    // Example Beast-Mode-style formula: SUM(Jobs Booked) / SUM(Leads) * 100,
    // not an average of a stored per-row rate column.
    id: 'CloseRate',
    columns: ['JobsBooked', 'Leads'],
    format: 'percent',
    compute: function (rows) {
      var leads = sumCol(rows, 'Leads');
      if (leads === 0) return null;
      return (sumCol(rows, 'JobsBooked') / leads) * 100;
    }
  },
  {
    // Example: SUM(Revenue) / SUM(Jobs Booked), not AVG(AvgTicket) —
    // a true "average ticket" is total revenue over total jobs, not
    // an average of per-row averages (which skews toward low-volume rows).
    id: 'AvgTicket',
    columns: ['Revenue', 'JobsBooked'],
    format: 'currency',
    compute: function (rows) {
      var jobs = sumCol(rows, 'JobsBooked');
      if (jobs === 0) return null;
      return sumCol(rows, 'Revenue') / jobs;
    }
  },
  { id: 'MarketingSpend', column: 'MarketingSpend',  agg: 'sum', format: 'currency' }
];

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
// MTD compares this month-so-far against the same number of days at
// the start of last month. YTD compares Jan 1-to-today against the
// same Jan 1-to-same-date window last year.
// ============================================
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function getDateRanges() {
  var now = new Date();
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

function inRange(dateStr, range) {
  return dateStr >= range[0] && dateStr <= range[1];
}

function aggregate(rows, column, agg) {
  var values = rows
    .map(function (row) { return Number(row[column]); })
    .filter(function (v) { return !isNaN(v); });

  if (values.length === 0) return agg === 'sum' ? 0 : null;

  var sum = values.reduce(function (a, b) { return a + b; }, 0);
  return agg === 'sum' ? sum : sum / values.length;
}

// Helpers for use inside a KPI's `compute` function — the Beast-Mode
// equivalent of SUM(column) / AVG(column) over the rows you're handed.
function sumCol(rows, column) {
  return aggregate(rows, column, 'sum');
}
function avgCol(rows, column) {
  return aggregate(rows, column, 'avg');
}

// Runs either shape of a KPI def against one window's rows.
function evaluateKpi(def, rows) {
  if (typeof def.compute === 'function') return def.compute(rows);
  return aggregate(rows, def.column, def.agg);
}

// ============================================
// RENDER
// ============================================
function renderKpi(def, rows, ranges) {
  var card = document.querySelector('.kpi-card[data-kpi="' + def.id + '"]');
  if (!card) return;

  var mtdRows = rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.mtd); });
  var mtdPriorRows = rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.mtdPrior); });
  var ytdRows = rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.ytd); });
  var ytdPriorRows = rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.ytdPrior); });

  var mtdValue = evaluateKpi(def, mtdRows);
  var mtdPriorValue = evaluateKpi(def, mtdPriorRows);
  var ytdValue = evaluateKpi(def, ytdRows);
  var ytdPriorValue = evaluateKpi(def, ytdPriorRows);

  var mtdDelta = formatDelta(mtdValue, mtdPriorValue, def.format, 'vs last month');
  var ytdDelta = formatDelta(ytdValue, ytdPriorValue, def.format, 'vs last yr');

  var mtdValueEl = card.querySelector('[data-mtd-value]');
  var mtdDeltaEl = card.querySelector('[data-mtd-delta]');
  var ytdValueEl = card.querySelector('[data-ytd-value]');
  var ytdDeltaEl = card.querySelector('[data-ytd-delta]');

  if (mtdValueEl) mtdValueEl.textContent = formatValue(mtdValue, def.format);
  if (mtdDeltaEl) {
    mtdDeltaEl.className = 'kpi-delta ' + mtdDelta.direction;
    mtdDeltaEl.innerHTML = '<span class="arrow"></span>' + mtdDelta.text;
  }
  if (ytdValueEl) ytdValueEl.textContent = formatValue(ytdValue, def.format);
  if (ytdDeltaEl) {
    ytdDeltaEl.className = 'kpi-ytd-delta ' + ytdDelta.direction;
    ytdDeltaEl.innerHTML = '<span class="arrow"></span>' + ytdDelta.text;
  }
}

function renderAll(rows) {
  var ranges = getDateRanges();
  KPI_DEFS.forEach(function (def) {
    renderKpi(def, rows, ranges);
  });
}

// ============================================
// FETCH + LOAD
// Pulls raw dt + every KPI column in one query, then computes all
// four windows (MTD, MTD-prior, YTD, YTD-prior) client-side per KPI.
// Only runs inside a real Domo runtime — outside of Domo the static
// placeholder numbers baked into index.html stay as-is for preview.
// Adjust LIMIT if BudgetBlindsData has more rows than this.
// ============================================
var LIMIT = 100000;

function loadKpisFromDomo() {
  var fieldSet = {};
  fieldSet[DATE_COLUMN] = true;
  KPI_DEFS.forEach(function (d) {
    (d.columns || [d.column]).forEach(function (c) { if (c) fieldSet[c] = true; });
  });
  var fields = Object.keys(fieldSet);

  var query = '/data/v1/' + DATASET_ALIAS +
    '?fields=' + fields.map(encodeURIComponent).join(',') +
    '&limit=' + LIMIT;

  domo.get(query)
    .then(function (rows) {
      renderAll(rows || []);
    })
    .catch(function (err) {
      console.error('Failed to load KPI data from ' + query, err);
    });
}

if (typeof domo !== 'undefined') {
  loadKpisFromDomo();

  // Optional integration with the companion nav bar app: if it (or
  // any other card) pushes a page-level filter via
  // domo.filterContainer(), Domo notifies listening apps here so this
  // row can re-render against the same audience. Safe no-op if the
  // App Framework build doesn't expose onFilterUpdate.
  if (typeof domo.onFilterUpdate === 'function') {
    domo.onFilterUpdate(function () {
      loadKpisFromDomo();
    });
  }
}
