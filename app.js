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
// ============================================

// Wires the open/close toggle for a dropdown (once) and its current
// set of items (every time, since items can be replaced at runtime
// by loadDropdownOptionsFromDomo()).
function wireDropdown(dropdown) {
  var toggleBtn = dropdown.querySelector('[data-toggle]');
  var valueLabel = dropdown.querySelector('[data-value]');
  var column = dropdown.getAttribute('data-column'); // e.g. "Brand", "HFCMasterID"

  if (!toggleBtn.dataset.wired) {
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.contains('open');
      // close any other open dropdowns first
      document.querySelectorAll('[data-dropdown].open').forEach(function (d) {
        d.classList.remove('open');
      });
      if (!isOpen) dropdown.classList.add('open');
    });
    toggleBtn.dataset.wired = 'true';
  }

  wireDropdownItems(dropdown, valueLabel, column);
  restoreDropdownSelection(dropdown, valueLabel, column);
}

// Attaches click handlers to whatever [data-select] items currently
// exist inside this dropdown. Safe to call again after the item list
// is replaced (e.g. once real dataset values load).
function wireDropdownItems(dropdown, valueLabel, column) {
  var items = dropdown.querySelectorAll('[data-select]');

  items.forEach(function (item, index) {
    item.addEventListener('click', function () {
      items.forEach(function (i) { i.classList.remove('selected'); });
      item.classList.add('selected');
      valueLabel.textContent = item.textContent;
      dropdown.classList.remove('open');

      // The "All ___" option is always the first item in each menu —
      // selecting it clears the filter for this column.
      var isAllOption = index === 0;

      if (!column) {
        // Compare dropdown has no dataset column — it's not a page
        // filter, it's a mode your own chart-rendering code reads.
        // Wire your comparison logic to the 'compareChange' event
        // below (or read window.currentCompareMode directly).
        window.currentCompareMode = item.textContent;
        navState.compare = item.textContent;
        saveNavState();
        document.dispatchEvent(new CustomEvent('compareChange', {
          detail: { mode: item.textContent }
        }));
        return;
      }

      navState.dropdowns[column] = item.textContent;
      saveNavState();

      // Guard against running outside a real Domo runtime (e.g. previewing
      // this file directly in a browser) — `domo` isn't declared there at
      // all, so referencing it unconditionally throws.
      if (typeof domo === 'undefined') return;

      domo.filterContainer([{
        column: column,
        operator: 'IN',
        values: isAllOption ? [] : [item.textContent],
        dataType: 'STRING'
      }]);
    });
  });
}

// Re-applies whatever was last selected for this dropdown (persisted
// in navState) after its items are (re)built — both the initial
// static-placeholder pass and the real-data pass from
// loadDropdownOptionsFromDomo() call this. No-ops quietly if nothing
// was ever selected (navState still at defaults) or if a previously
// selected value no longer exists in the current item list.
function restoreDropdownSelection(dropdown, valueLabel, column) {
  var saved = column ? navState.dropdowns[column] : navState.compare;
  if (!saved) return;

  var items = dropdown.querySelectorAll('[data-select]');
  var match = null;
  items.forEach(function (item) {
    if (item.textContent === saved) match = item;
  });
  if (!match) return;

  items.forEach(function (i) { i.classList.remove('selected'); });
  match.classList.add('selected');
  valueLabel.textContent = match.textContent;

  if (!column) {
    window.currentCompareMode = match.textContent;
    document.dispatchEvent(new CustomEvent('compareChange', {
      detail: { mode: match.textContent }
    }));
    return;
  }

  if (typeof domo === 'undefined') return;
  var isAllOption = items[0] === match;
  domo.filterContainer([{
    column: column,
    operator: 'IN',
    values: isAllOption ? [] : [match.textContent],
    dataType: 'STRING'
  }]);
}

document.querySelectorAll('[data-dropdown]').forEach(wireDropdown);

// Close any open dropdown when clicking outside
document.addEventListener('click', function () {
  document.querySelectorAll('[data-dropdown].open').forEach(function (d) {
    d.classList.remove('open');
  });
});

// ============================================
// POPULATE DROPDOWNS FROM THE REAL DATASET
// Only runs inside a real Domo runtime (domo dev or a published app).
// Outside of Domo, the static placeholder items already in
// index.html (Two Maids, Owner A, etc.) are left as-is for preview.
// ============================================
function loadDropdownOptionsFromDomo() {
  document.querySelectorAll('[data-dropdown][data-column]').forEach(function (dropdown) {
    var column = dropdown.getAttribute('data-column');
    var alias = COLUMN_TO_ALIAS[column];
    if (!alias) return;

    var query = '/data/v1/' + DATASET_ALIAS +
      '?fields=' + encodeURIComponent(alias) +
      '&groupby=' + encodeURIComponent(alias) +
      '&orderby=' + encodeURIComponent(alias);

    domo.get(query)
      .then(function (rows) {
        var menu = dropdown.querySelector('.dropdown-menu');
        var menuItems = menu.querySelectorAll('[data-select]');

        // Keep the first item (the "All ..." option) and drop the
        // rest of the static placeholders before appending real values.
        menuItems.forEach(function (item, i) {
          if (i > 0) item.remove();
        });

        rows
          .map(function (row) { return row[alias]; })
          .filter(function (v) { return v !== null && v !== undefined && v !== ''; })
          .forEach(function (value) {
            var el = document.createElement('div');
            el.className = 'dropdown-item';
            el.setAttribute('data-select', '');
            el.textContent = String(value);
            menu.appendChild(el);
          });

        var valueLabel = dropdown.querySelector('[data-value]');
        wireDropdownItems(dropdown, valueLabel, column);
        restoreDropdownSelection(dropdown, valueLabel, column);
      })
      .catch(function (err) {
        console.error('Failed to load options for ' + column + ' from ' + query, err);
      });
  });
}

if (typeof domo !== 'undefined') {
  loadDropdownOptionsFromDomo();
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
