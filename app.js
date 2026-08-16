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

  // Ported directly from the real Leads Beast Mode:
  //   COUNT(DISTINCT CASE WHEN Type='Leads' AND Category<>'Spend'
  //     AND dt < CURRENT_DATE() THEN CONCAT(OrganizationID, LeadID,
  //     MONTH(dt), YEAR(dt)) END)
  // `filterRows` replaces the Type/Category CASE conditions,
  // `distinctKey` replaces the CONCAT(...) dedup key, and
  // `excludeToday: true` replaces the AND dt < CURRENT_DATE() clause
  // (today is always dropped from both the MTD and YTD windows for
  // this KPI, since the Beast Mode applies that filter unconditionally
  // across every period branch). The Beast Mode's own MTD/PM/YTD/Custom
  // branching isn't reproduced here — this app owns its own fixed
  // MTD-vs-last-month / YTD-vs-last-year windows below rather than
  // reading the page's period selector.
  {
    id: 'Leads',
    columns: ['Type', 'Category', 'OrganizationID', 'LeadID'],
    format: 'number',
    excludeToday: true,
    filterRows: function (rows) {
      return rows.filter(function (r) {
        return r.Type === 'Leads' && r.Category !== 'Spend';
      });
    },
    distinctKey: function (row) {
      var d = new Date(row[DATE_COLUMN]);
      return [row.OrganizationID, row.LeadID, d.getMonth() + 1, d.getFullYear()].join('|');
    },
    compute: function (rows, def) {
      return distinctCount(rows, def.distinctKey);
    }
  },

  // PLACEHOLDER — the Leads Beast Mode shows this dataset is
  // transaction-level (Type/Category per row), so JobsBooked likely
  // needs a similar Type-filtered distinct/sum formula rather than a
  // dedicated numeric column. Swap in the real Beast Mode once available.
  { id: 'JobsBooked',     column: 'JobsBooked',      agg: 'sum', format: 'number'   },

  {
    // Placeholder ratio: JobsBooked / (distinct Leads, same definition
    // as the Leads card above) * 100. Update once JobsBooked is ported
    // to its real formula. excludeToday matches Leads' own window so
    // both sides of the ratio cover the same days.
    id: 'CloseRate',
    columns: ['JobsBooked', 'Type', 'Category', 'OrganizationID', 'LeadID'],
    format: 'percent',
    excludeToday: true,
    compute: function (rows) {
      var leads = distinctCount(LEADS_DEF.filterRows(rows), LEADS_DEF.distinctKey);
      if (leads === 0) return null;
      return (sumCol(rows, 'JobsBooked') / leads) * 100;
    }
  },
  {
    // Placeholder ratio: SUM(Revenue) / SUM(Jobs Booked), not
    // AVG(AvgTicket) — a true average ticket is total revenue over
    // total jobs, not an average of per-row averages.
    id: 'AvgTicket',
    columns: ['Revenue', 'JobsBooked'],
    format: 'currency',
    compute: function (rows) {
      var jobs = sumCol(rows, 'JobsBooked');
      if (jobs === 0) return null;
      return sumCol(rows, 'Revenue') / jobs;
    }
  },

  // PLACEHOLDER — likely Type='Spend'/Category='Spend' filtered, per
  // the Leads formula's `Category <> 'Spend'` exclusion implying a
  // 'Spend' category exists in this same column.
  { id: 'MarketingSpend', column: 'MarketingSpend',  agg: 'sum', format: 'currency' }
];

// Reused by CloseRate above so both KPIs count "a lead" the exact
// same way instead of duplicating the filter/dedup logic.
var LEADS_DEF = KPI_DEFS.filter(function (d) { return d.id === 'Leads'; })[0];

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

// The Beast-Mode equivalent of COUNT(DISTINCT keyFn(row)).
function distinctCount(rows, keyFn) {
  var seen = {};
  var count = 0;
  rows.forEach(function (r) {
    var k = keyFn(r);
    if (!(k in seen)) { seen[k] = true; count++; }
  });
  return count;
}

// Clips a [start, end] range's end to yesterday when a KPI's Beast
// Mode excludes "today" unconditionally (see the Leads def above).
// Only ever tightens the range, never widens it.
function clipEndForToday(range, excludeToday) {
  if (!excludeToday) return range;
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var yStr = toISODate(yesterday);
  return [range[0], range[1] < yStr ? range[1] : yStr];
}

// Applies a KPI's row-level filter (e.g. Leads' Type/Category match)
// ahead of aggregation. Returns the detail rows that actually feed
// the number — the same set the drill-down modal displays.
function detailRowsFor(def, dateWindowRows) {
  return def.filterRows ? def.filterRows(dateWindowRows) : dateWindowRows;
}

// Runs either shape of a KPI def against its (already filtered) detail rows.
function evaluateKpi(def, detailRows) {
  if (typeof def.compute === 'function') return def.compute(detailRows, def);
  return aggregate(detailRows, def.column, def.agg);
}

// Populated by renderKpi so the drill-down modal can show exactly
// the rows behind whichever number was clicked, with no re-fetch.
var kpiRowCache = {};

// ============================================
// RENDER
// ============================================
function renderKpi(def, rows, ranges) {
  var card = document.querySelector('.kpi-card[data-kpi="' + def.id + '"]');
  if (!card) return;

  var mtdRange = clipEndForToday(ranges.mtd, def.excludeToday);
  var ytdRange = clipEndForToday(ranges.ytd, def.excludeToday);

  var mtdRows = detailRowsFor(def, rows.filter(function (r) { return inRange(r[DATE_COLUMN], mtdRange); }));
  var mtdPriorRows = detailRowsFor(def, rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.mtdPrior); }));
  var ytdRows = detailRowsFor(def, rows.filter(function (r) { return inRange(r[DATE_COLUMN], ytdRange); }));
  var ytdPriorRows = detailRowsFor(def, rows.filter(function (r) { return inRange(r[DATE_COLUMN], ranges.ytdPrior); }));

  // Cache the exact detail rows behind each number for the drill-down
  // modal — same rows evaluateKpi() aggregates, just not aggregated.
  kpiRowCache[def.id] = {
    mtd: { rows: mtdRows, range: mtdRange, label: 'MTD' },
    ytd: { rows: ytdRows, range: ytdRange, label: 'YTD' }
  };

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
// DRILL-DOWN
// Clicking a card's MTD or YTD number opens an in-app panel listing
// the exact detail rows behind that number (from kpiRowCache — no
// extra domo.get needed). "Filter the rest of the page" pushes the
// same window as a domo.filterContainer BETWEEN so other native
// Domo cards on the page can drill the same way.
// ============================================
var modalEl = document.getElementById('drilldownModal');

function kpiTitleFor(id) {
  var titleEl = document.querySelector('.kpi-card[data-kpi="' + id + '"] .kpi-title');
  return titleEl ? titleEl.textContent : id;
}

function openDrilldown(kpiId, windowKey) {
  var def = KPI_DEFS.filter(function (d) { return d.id === kpiId; })[0];
  var cached = kpiRowCache[kpiId] && kpiRowCache[kpiId][windowKey];
  if (!def || !cached || !modalEl) return;

  var columns = [DATE_COLUMN].concat(def.columns || [def.column]).filter(Boolean);
  var rows = cached.rows;
  var ROW_CAP = 200;

  modalEl.querySelector('[data-modal-title]').textContent = kpiTitleFor(kpiId) + ' — ' + cached.label;
  modalEl.querySelector('[data-modal-subtitle]').textContent =
    cached.range[0] + ' to ' + cached.range[1] + ' · ' + rows.length.toLocaleString('en-US') + ' row' + (rows.length === 1 ? '' : 's');

  var thead = '<tr>' + columns.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
  var tbody = rows.slice(0, ROW_CAP).map(function (row) {
    return '<tr>' + columns.map(function (c) {
      var v = row[c];
      return '<td>' + (v === null || v === undefined ? '—' : String(v)) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  modalEl.querySelector('[data-modal-thead]').innerHTML = thead;
  modalEl.querySelector('[data-modal-tbody]').innerHTML = tbody || '<tr><td colspan="' + columns.length + '">No rows in this window.</td></tr>';

  var capNote = modalEl.querySelector('[data-modal-cap]');
  capNote.textContent = rows.length > ROW_CAP ? 'Showing first ' + ROW_CAP + ' of ' + rows.length.toLocaleString('en-US') + ' rows.' : '';

  var filterBtn = modalEl.querySelector('[data-modal-filter]');
  filterBtn.onclick = function () {
    if (typeof domo === 'undefined') return;
    var filters = [{ column: DATE_COLUMN, operator: 'BETWEEN', values: cached.range, dataType: 'DATE' }];
    if (typeof def.drillFilters === 'function') filters = filters.concat(def.drillFilters());
    domo.filterContainer(filters);
    closeDrilldown();
  };
  // Only useful inside a real Domo runtime with other cards on the page.
  filterBtn.style.display = typeof domo === 'undefined' ? 'none' : '';

  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';
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
