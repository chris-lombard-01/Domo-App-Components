// ============================================
// DATASET WIRING
// This is a Domo App Code app (migrated off DDX Bricks). Deliberately
// NOT using a variable named `datasets` here — a top-level `var
// datasets = [...]` becomes a global (window.datasets) in a browser
// regardless of how it's declared, which is exactly the pattern
// Domo's editor flags as "looks like it migrated from a Brick."
// The alias below is confirmed directly against Resources > Datasets
// > schema in the App Code editor (Dataset ID f708d305-..., alias
// BudgetBlindsData, with live preview rows), so it's hardcoded here.
// domo.js itself IS provided automatically via the <script
// src="domo.js"> tag in index.html (the reverse of Bricks, where
// that same tag 404s and window.domo is auto-injected instead).
//
// data-column in index.html holds the RAW column name (what
// domo.filterContainer needs, since sibling cards on the page only
// know real column names). COLUMN_TO_ALIAS maps each raw column back
// to this app's field alias (what domo.get needs to query its own
// dataset mapping).
// ============================================
var DATASET_ALIAS = 'BudgetBlindsData'; // Resources > Datasets > schema > Alias

var COLUMN_TO_ALIAS = {
  'Brand': 'Brand',
  'HFCMasterID': 'HFCMasterID',
  'FranchiseName': 'Owner',
  'TerrNum': 'TerrNumName'
};

// ============================================
// PERSISTED STATE
// Root cause of "it filters and resets": domo.filterContainer()
// changes the page's filtered view, and Domo reloads cards bound to
// that view — including this app's own instance, since it's bound to
// BudgetBlindsData too. This whole script re-runs from the top on
// that reload, which rebuilds the segmented control/dropdowns from
// index.html's *static* defaults (MTD active, "All ..." selected) and
// then re-pushes MTD unconditionally — wiping out whatever was just
// selected a moment earlier.
//
// localStorage survives that reload, so instead of always falling
// back to the static defaults, the app restores (and re-pushes)
// whatever was last selected. Same key is shared across every Studio
// page this app is placed on (same-origin iframes share
// localStorage), so a selection made on one page carries over to the
// others too — worth confirming that holds in your actual Domo
// instance; if each App Code instance turns out to be sandboxed to
// its own origin, this still fixes the reset bug, it just won't sync
// across pages.
// ============================================
var STORAGE_KEY = 'claudeNav.state.v1';

function loadNavState() {
  var defaults = {
    period: 'MTD',
    customFrom: '',
    customTo: '',
    dropdowns: {},   // { rawColumnName: selectedItemText }
    compare: 'Prior Period'
  };
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    var parsed = JSON.parse(raw);
    return {
      period: parsed.period || defaults.period,
      customFrom: parsed.customFrom || defaults.customFrom,
      customTo: parsed.customTo || defaults.customTo,
      dropdowns: parsed.dropdowns || defaults.dropdowns,
      compare: parsed.compare || defaults.compare
    };
  } catch (e) {
    return defaults;
  }
}

var navState = loadNavState();

function saveNavState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(navState));
  } catch (e) {
    // Private-mode/quota/etc — selections just won't survive a
    // reload, nothing else breaks.
  }
}

// ============================================
// DROPDOWN BEHAVIOR
// Native <select> elements, not a custom-built menu — this app runs
// in an iframe sized to its Domo card, and a position:absolute menu
// gets clipped the moment it would extend past that box (the clip is
// the iframe boundary, not a CSS overflow setting, so no z-index/
// position trick escapes it). A native select's open option list is
// painted by the browser above the page/iframe stacking context, so
// it isn't subject to that clipping — the same reason the date
// pickers below already worked.
// ============================================

// Wires a select's change handler (once) and restores its persisted
// selection. Called both for the static-placeholder <option>s at
// load and again after loadSelectOptionsFromDomo() replaces them with
// real values.
function wireSelect(select) {
  var column = select.getAttribute('data-column'); // null for Compare — cosmetic only, no dataset column

  if (!select.dataset.wired) {
    select.addEventListener('change', function () {
      handleSelectChange(select, column);
    });
    select.dataset.wired = 'true';
  }

  restoreSelectSelection(select, column);
}

// A select's own value IS the filter value ("" for the "All ..."
// option, since that <option> has value=""). Updates the .filtered
// styling, persists the choice, and pushes it as a page filter (or,
// for Compare, dispatches compareChange instead — see index.html).
function handleSelectChange(select, column) {
  var value = select.value;
  var isAllOption = value === '';
  select.classList.toggle('filtered', !isAllOption);

  if (!column) {
    window.currentCompareMode = value;
    navState.compare = value;
    saveNavState();
    document.dispatchEvent(new CustomEvent('compareChange', {
      detail: { mode: value }
    }));
    return;
  }

  navState.dropdowns[column] = value;
  saveNavState();

  // Guard against running outside a real Domo runtime (e.g. previewing
  // this file directly in a browser) — `domo` isn't declared there at
  // all, so referencing it unconditionally throws.
  if (typeof domo === 'undefined') return;

  domo.filterContainer([{
    column: column,
    operator: 'IN',
    values: isAllOption ? [] : [value],
    dataType: 'STRING'
  }]);
}

// Re-applies whatever was last selected for this select (persisted in
// navState) after its <option>s are (re)built. No-ops quietly if
// nothing was ever selected, or if a previously selected value no
// longer exists among the current <option>s.
function restoreSelectSelection(select, column) {
  var saved = column ? navState.dropdowns[column] : navState.compare;
  if (!saved) return;

  var hasOption = Array.prototype.some.call(select.options, function (opt) {
    return opt.value === saved;
  });
  if (!hasOption) return;

  select.value = saved;
  select.classList.toggle('filtered', saved !== '');

  if (!column) {
    window.currentCompareMode = saved;
    document.dispatchEvent(new CustomEvent('compareChange', {
      detail: { mode: saved }
    }));
    return;
  }

  if (typeof domo === 'undefined') return;
  domo.filterContainer([{
    column: column,
    operator: 'IN',
    values: saved === '' ? [] : [saved],
    dataType: 'STRING'
  }]);
}

document.querySelectorAll('[data-dropdown]').forEach(wireSelect);

// ============================================
// POPULATE DROPDOWNS FROM THE REAL DATASET
// Only runs inside a real Domo runtime (domo dev or a published app).
// Outside of Domo, the static placeholder <option>s already in
// index.html (Two Maids, Owner A, etc.) are left as-is for preview.
// ============================================
function loadSelectOptionsFromDomo() {
  document.querySelectorAll('[data-dropdown][data-column]').forEach(function (select) {
    var column = select.getAttribute('data-column');
    var alias = COLUMN_TO_ALIAS[column];
    if (!alias) return;

    var query = '/data/v1/' + DATASET_ALIAS +
      '?fields=' + encodeURIComponent(alias) +
      '&groupby=' + encodeURIComponent(alias) +
      '&orderby=' + encodeURIComponent(alias);

    domo.get(query)
      .then(function (rows) {
        // Keep the first <option> (the "All ..." choice, value="")
        // and drop the rest of the static placeholders before
        // appending real values.
        Array.prototype.slice.call(select.options, 1).forEach(function (opt) {
          opt.remove();
        });

        rows
          .map(function (row) { return row[alias]; })
          .filter(function (v) { return v !== null && v !== undefined && v !== ''; })
          .forEach(function (value) {
            var opt = document.createElement('option');
            opt.textContent = String(value);
            select.appendChild(opt);
          });

        restoreSelectSelection(select, column);
      })
      .catch(function (err) {
        console.error('Failed to load options for ' + column + ' from ' + query, err);
      });
  });
}

if (typeof domo !== 'undefined') {
  loadSelectOptionsFromDomo();
}

// ============================================
// REPORTING PERIOD TOGGLE
// ============================================
var DATE_COLUMN = 'dt'; // confirmed real column name for date filtering
var dateRange = document.getElementById('dateRange');
var fromDate = document.getElementById('fromDate');
var toDate = document.getElementById('toDate');

// Format a JS Date as YYYY-MM-DD, which is what domo.filterContainer expects
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Returns [startDateString, endDateString] for a given period
function getRange(period) {
  var now = new Date();
  var start;
  if (period === 'MTD') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'QTD') {
    var qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), qStartMonth, 1);
  } else if (period === 'YTD') {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return [toISODate(start), toISODate(now)];
}

function applyDateFilter(startStr, endStr) {
  if (typeof domo === 'undefined') return;
  domo.filterContainer([{
    column: DATE_COLUMN,
    operator: 'BETWEEN',
    values: [startStr, endStr],
    dataType: 'DATE'
  }]);
}

// Marks the correct segmented-control button active and pushes the
// matching date filter. `persist` is false when this is a restore on
// load (state is already saved — re-saving is harmless but pointless)
// and true on an actual user click.
function selectPeriod(periodKey, persist) {
  document.querySelectorAll('[data-period]').forEach(function (btn) {
    var key = btn.getAttribute('data-period') || btn.textContent;
    btn.classList.toggle('active', key === periodKey);
  });

  var isCustom = periodKey === 'custom';
  dateRange.classList.toggle('visible', isCustom);

  if (persist) {
    navState.period = periodKey;
    saveNavState();
  }

  if (isCustom) {
    // Wait for the user to actually pick dates rather than filtering
    // on empty/partial values — unless a prior Custom selection is
    // being restored and both dates are already filled in below.
    if (fromDate.value && toDate.value) applyDateFilter(fromDate.value, toDate.value);
    return;
  }
  var range = getRange(periodKey);
  applyDateFilter(range[0], range[1]);
}

document.querySelectorAll('[data-period]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var periodKey = btn.getAttribute('data-period') || btn.textContent; // MTD/QTD/YTD or "custom"
    selectPeriod(periodKey, true);
  });
});

// Re-apply filtering whenever a custom date is edited
[fromDate, toDate].forEach(function (input) {
  input.addEventListener('change', function () {
    if (fromDate.value && toDate.value) {
      navState.customFrom = fromDate.value;
      navState.customTo = toDate.value;
      saveNavState();
      applyDateFilter(fromDate.value, toDate.value);
    }
  });
});

// Restore whatever was last selected instead of always re-pushing
// MTD — this is what actually fixes the "filters then resets" bug,
// since this line used to unconditionally push MTD on every reload
// (including the reload triggered by the user's own selection above).
if (navState.period === 'custom') {
  fromDate.value = navState.customFrom;
  toDate.value = navState.customTo;
}
selectPeriod(navState.period, false);
