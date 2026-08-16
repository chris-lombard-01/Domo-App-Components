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
// One entry per tile. `column` is the raw dataset column this KPI
// aggregates. `format` controls how numbers render. `agg` is 'sum'
// (totals, e.g. Revenue, Leads) or 'avg' (rates/averages, e.g. Close
// Rate, Avg Ticket). Add/remove entries here to change which KPIs
// show — just keep index.html's data-kpi values in sync (each needs
// a matching .kpi-card with data-mtd-value/data-mtd-delta/
// data-ytd-value/data-ytd-delta spans).
//
// IMPORTANT: Revenue/Leads/JobsBooked/CloseRate/AvgTicket/
// MarketingSpend are placeholder column names — swap them for the
// real columns in BudgetBlindsData (or whatever dataset this app is
// bound to) and update manifest.json's datasetsMapping fields to
// match.
// ============================================
var KPI_DEFS = [
  { id: 'Revenue',        column: 'Revenue',        agg: 'sum', format: 'currency' },
  { id: 'Leads',          column: 'Leads',           agg: 'sum', format: 'number'   },
  { id: 'JobsBooked',     column: 'JobsBooked',      agg: 'sum', format: 'number'   },
  { id: 'CloseRate',      column: 'CloseRate',       agg: 'avg', format: 'percent'  },
  { id: 'AvgTicket',      column: 'AvgTicket',       agg: 'avg', format: 'currency' },
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

  var mtdValue = aggregate(mtdRows, def.column, def.agg);
  var mtdPriorValue = aggregate(mtdPriorRows, def.column, def.agg);
  var ytdValue = aggregate(ytdRows, def.column, def.agg);
  var ytdPriorValue = aggregate(ytdPriorRows, def.column, def.agg);

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
  var fields = [DATE_COLUMN].concat(KPI_DEFS.map(function (d) { return d.column; }));
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
