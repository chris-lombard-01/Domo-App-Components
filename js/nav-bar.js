/* =========================================================
   Custom Domo App Studio Navigation Bar — behavior
   Renders dropdown filters + reporting-period segmented control
   from a config object, and emits a single change event that the
   rest of the app studio app (charts, domo.get calls) can listen to.
   ========================================================= */

(function (global) {
  "use strict";

  var CHEVRON_SVG =
    '<svg class="dnb-chevron" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var CHECK_SVG =
    '<svg class="dnb-option-check" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function el(tag, className, html) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function DomoNavBar(root, config) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.root) throw new Error("DomoNavBar: mount element not found");

    this.config = config || {};
    this.filters = this.config.filters || [];
    this.trailingFilters = this.config.trailingFilters || [];
    this.periods = this.config.periods || ["MTD", "QTD", "YTD", "Custom"];
    this.state = {};
    this.listeners = [];

    this.filters.concat(this.trailingFilters).forEach(function (f) {
      this.state[f.id] = f.value || (f.options && f.options[0] && f.options[0].value) || "";
    }, this);
    this.state.reportingPeriod = this.config.defaultPeriod || this.periods[0];
    this.state.customRange = { start: "", end: "" };

    this._build();
    this._bindGlobalClose();
  }

  DomoNavBar.prototype._build = function () {
    var self = this;
    this.root.classList.add("dnb");
    this.root.innerHTML = "";

    if (this.config.title) {
      var brand = el("div", "dnb-brand");
      brand.appendChild(el("span", "dnb-brand-dot"));
      brand.appendChild(document.createTextNode(this.config.title));
      this.root.appendChild(brand);
    }

    var filterWrap = el("div", "dnb-filters");

    this.filters.forEach(function (f) {
      filterWrap.appendChild(self._buildDropdown(f));
    });

    if (this.periods && this.periods.length) {
      filterWrap.appendChild(el("div", "dnb-divider"));
      filterWrap.appendChild(this._buildPeriod());
    }

    if (this.trailingFilters.length) {
      filterWrap.appendChild(el("div", "dnb-divider"));
      this.trailingFilters.forEach(function (f) {
        filterWrap.appendChild(self._buildDropdown(f));
      });
    }

    this.root.appendChild(filterWrap);
  };

  DomoNavBar.prototype._buildDropdown = function (f) {
    var self = this;
    var wrap = el("div", "dnb-filter");
    wrap.dataset.filterId = f.id;

    wrap.appendChild(el("label", "dnb-label", f.label || f.id));

    var control = el("button", "dnb-control");
    control.type = "button";
    control.setAttribute("aria-haspopup", "listbox");
    control.setAttribute("aria-expanded", "false");

    var valueSpan = el("span", "dnb-control-value");
    control.appendChild(valueSpan);
    control.insertAdjacentHTML("beforeend", CHEVRON_SVG);
    wrap.appendChild(control);

    var panel = el("div", "dnb-panel");
    var searchable = f.searchable !== false && f.options && f.options.length > 6;
    var searchInput;
    if (searchable) {
      searchInput = el("input", "dnb-panel-search");
      searchInput.type = "text";
      searchInput.placeholder = "Search " + (f.label || f.id).toLowerCase() + "...";
      panel.appendChild(searchInput);
    }
    var optionsList = el("div", "dnb-options");
    panel.appendChild(optionsList);
    wrap.appendChild(panel);

    function renderOptions(filterText) {
      optionsList.innerHTML = "";
      var term = (filterText || "").trim().toLowerCase();
      var opts = (f.options || []).filter(function (o) {
        return !term || o.label.toLowerCase().indexOf(term) !== -1;
      });
      if (!opts.length) {
        optionsList.appendChild(el("div", "dnb-empty", "No matches"));
        return;
      }
      opts.forEach(function (o) {
        var opt = el("div", "dnb-option");
        opt.setAttribute("role", "option");
        opt.tabIndex = 0;
        if (self.state[f.id] === o.value) opt.classList.add("selected");
        opt.appendChild(document.createTextNode(o.label));
        opt.insertAdjacentHTML("beforeend", CHECK_SVG);
        opt.addEventListener("click", function () {
          self._select(f, o, wrap, valueSpan, control, renderOptions);
        });
        optionsList.appendChild(opt);
      });
    }

    renderOptions();
    this._syncControlLabel(f, valueSpan, control);

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        renderOptions(searchInput.value);
      });
      searchInput.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    control.addEventListener("click", function (e) {
      e.stopPropagation();
      self._toggle(wrap, control);
      if (searchInput) setTimeout(function () { searchInput.focus(); }, 0);
    });

    return wrap;
  };

  DomoNavBar.prototype._select = function (f, option, wrap, valueSpan, control, renderOptions) {
    this.state[f.id] = option.value;
    this._syncControlLabel(f, valueSpan, control);
    renderOptions();
    this._close(wrap, control);
    this._emitChange(f.id, option.value);
  };

  DomoNavBar.prototype._syncControlLabel = function (f, valueSpan, control) {
    var opt = (f.options || []).find(function (o) { return o.value === this.state[f.id]; }, this);
    var label = opt ? opt.label : (f.placeholder || "Select");
    valueSpan.textContent = label;
    valueSpan.classList.toggle("is-placeholder", !opt);
    var isNonDefault = opt && (f.defaultValue === undefined || opt.value !== f.defaultValue);
    control.classList.toggle("has-value", !!isNonDefault);
  };

  DomoNavBar.prototype._buildPeriod = function () {
    var self = this;
    var wrap = el("div", "dnb-filter dnb-period");
    wrap.appendChild(el("label", "dnb-label", "Reporting Period"));

    var seg = el("div", "dnb-segmented");
    this.periods.forEach(function (p) {
      var btn = el("button", "dnb-segment", p);
      btn.type = "button";
      if (p === self.state.reportingPeriod) btn.classList.add("active");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        seg.querySelectorAll(".dnb-segment").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        self.state.reportingPeriod = p;
        if (p === "Custom") {
          self._toggle(wrap, btn);
        } else {
          self._close(wrap, btn);
          self._emitChange("reportingPeriod", p);
        }
      });
      seg.appendChild(btn);
    });
    wrap.appendChild(seg);

    var range = el("div", "dnb-custom-range");
    range.appendChild(el("label", null, "Start Date"));
    var start = el("input", null); start.type = "date";
    range.appendChild(start);
    range.appendChild(el("label", null, "End Date"));
    var end = el("input", null); end.type = "date";
    range.appendChild(end);
    var apply = el("button", "dnb-apply-btn", "Apply");
    apply.type = "button";
    apply.addEventListener("click", function (e) {
      e.stopPropagation();
      self.state.customRange = { start: start.value, end: end.value };
      self._close(wrap, apply);
      self._emitChange("reportingPeriod", "Custom", self.state.customRange);
    });
    range.appendChild(apply);
    range.addEventListener("click", function (e) { e.stopPropagation(); });
    wrap.appendChild(range);

    return wrap;
  };

  DomoNavBar.prototype._toggle = function (wrap, control) {
    var isOpen = wrap.classList.contains("open");
    this._closeAll();
    if (!isOpen) {
      wrap.classList.add("open");
      if (control) control.setAttribute("aria-expanded", "true");
    }
  };

  DomoNavBar.prototype._close = function (wrap, control) {
    wrap.classList.remove("open");
    if (control) control.setAttribute("aria-expanded", "false");
  };

  DomoNavBar.prototype._closeAll = function () {
    this.root.querySelectorAll(".dnb-filter.open").forEach(function (w) {
      w.classList.remove("open");
      var c = w.querySelector(".dnb-control, .dnb-segment.active");
      if (c) c.setAttribute && c.setAttribute("aria-expanded", "false");
    });
  };

  DomoNavBar.prototype._bindGlobalClose = function () {
    var self = this;
    document.addEventListener("click", function () { self._closeAll(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") self._closeAll();
    });
  };

  DomoNavBar.prototype._emitChange = function (filterId, value, extra) {
    var detail = {
      filterId: filterId,
      value: value,
      extra: extra || null,
      state: this.getState()
    };
    this.listeners.forEach(function (cb) { cb(detail); });
    this.root.dispatchEvent(new CustomEvent("navbar:change", { detail: detail, bubbles: true }));
  };

  DomoNavBar.prototype.onChange = function (cb) {
    this.listeners.push(cb);
    return this;
  };

  DomoNavBar.prototype.getState = function () {
    return JSON.parse(JSON.stringify(this.state));
  };

  DomoNavBar.prototype.setOptions = function (filterId, options) {
    var f = this.filters.find(function (x) { return x.id === filterId; });
    if (!f) return;
    f.options = options;
    this._build();
  };

  global.DomoNavBar = DomoNavBar;
})(window);
