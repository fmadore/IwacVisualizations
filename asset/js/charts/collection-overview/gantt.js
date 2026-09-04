/**
 * IWAC Visualizations — Collection Overview: Newspaper Gantt panel
 *
 * Horizontal period bars (year_min → year_max) per newspaper, faceted by
 * country and by item type. Both facets are independent; their states
 * merge into a single filter pass before calling C.gantt.
 *
 * The chart holds 82 press runs and shows 20 at a time. That window used to be
 * invisible — a thin ECharts slider, no count anywhere — and the default
 * ordering was the bundle's own, which put 19 Burkinabè papers and one
 * Béninois in it. So the honest reading of the default state was "IWAC holds
 * about a dozen newspapers, all Burkinabè but one", on the collection's own
 * overview page. Two changes fix that: the rows are ordered by how much of
 * each paper the collection holds (so "the first 20" is a statement a reader
 * can evaluate), and the window is disclosed with a control that escapes it.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/gantt: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';
    var WINDOW_SIZE = 20;

    function render(panelEl, data) {
        var coverage = (data && data.newspapers && data.newspapers.coverage) || [];
        if (coverage.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var state = { country: ALL_KEY, type: ALL_KEY };

        var countries = {};
        countries[ALL_KEY] = P.t('All countries');
        coverage.forEach(function (e) {
            if (e.country) countries[e.country] = e.country;
        });

        var types = {};
        types[ALL_KEY] = P.t('All types');
        coverage.forEach(function (e) {
            if (e.type) types[e.type] = P.t('item_type_' + e.type);
        });

        // Two facet bars, one per dimension — rendered side-by-side
        var facetsWrap = P.el('div', 'iwac-vis-facets-pair');
        facetsWrap.style.display = 'flex';
        facetsWrap.style.flexWrap = 'wrap';
        facetsWrap.style.gap = '1rem';

        var countryBar = P.buildFacetButtons({
            facets: [{
                key: 'country',
                label: P.t('Country'),
                subFacets: countries,
                renderAs: 'select'
            }],
            activeKey: 'country',
            onChange: function (evt) {
                state.country = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        var typeBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        facetsWrap.appendChild(countryBar.root);
        facetsWrap.appendChild(typeBar.root);
        panelEl.panel.insertBefore(facetsWrap, panelEl.chart);

        function filtered() {
            return coverage.filter(function (e) {
                if (state.country !== ALL_KEY && e.country !== state.country) return false;
                if (state.type !== ALL_KEY && e.type !== state.type) return false;
                return true;
            // Most-held first, so the window the panel discloses is a
            // statement about the collection ("the 20 best-covered titles")
            // rather than an accident of the bundle's row order. Ties keep
            // their relative order, which for a Gantt reads as stable.
            }).sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
        }

        // Disclosure + expand control, above the chart so it is read BEFORE
        // the truncated view, not offered as an afterthought below it.
        var disclosure = P.buildWindowDisclosure({
            windowSize: WINDOW_SIZE,
            total: filtered().length,
            noteKey:     'gantt_window_note',
            allKey:      'gantt_window_all',
            showAllKey:  'gantt_show_all',
            showTopKey:  'gantt_show_top',
            onToggle:    function () { rerender(); }
        });
        panelEl.panel.insertBefore(disclosure.root, panelEl.chart);

        // Country key. The bars are drawn by a custom series, so ECharts
        // generates no legend for them — which left the one page element that
        // teaches the country → colour grammar (the timeline's legend, two
        // panels up) doing the work for a chart that never repeated it. Now
        // that every panel agrees on the mapping, repeating the key here is
        // what makes learning it pay.
        //
        // Rebuilt from the FILTERED rows, so a country facet leaves a key with
        // one entry rather than six, five of which are absent from the chart.
        var key = P.el('ul', 'iwac-vis-key');
        key.setAttribute('aria-label', P.t('Countries'));
        panelEl.panel.insertBefore(key, panelEl.chart);

        function paintKey(rows) {
            key.innerHTML = '';
            var seen = [];
            rows.forEach(function (row) {
                if (row.country && seen.indexOf(row.country) === -1) seen.push(row.country);
            });
            seen.sort();
            seen.forEach(function (country) {
                var item = P.el('li', 'iwac-vis-key__item');
                var swatch = P.el('span', 'iwac-vis-key__swatch');
                // Read per paint, not once: the render callback re-runs on the
                // light/dark swap, and the two lead slots differ between them.
                swatch.style.background = C._countryColor(country);
                swatch.setAttribute('aria-hidden', 'true');
                item.appendChild(swatch);
                item.appendChild(document.createTextNode(country));
                key.appendChild(item);
            });
            key.hidden = seen.length < 2;
        }

        function optionFor(rows) {
            return C.gantt(rows, {
                windowSize: WINDOW_SIZE,
                expanded: disclosure.isExpanded()
            });
        }

        /**
         * The host owns the height, in BOTH states, and always from the row
         * count actually on screen.
         *
         * It used to fall back to the panel's CSS floor whenever it was not
         * expanded, which decoupled the two: the collapsed view drew its 20
         * rows into whatever 320px min-height left over — about 11px each,
         * with an 11px font, so the titles touched. Deriving the collapsed
         * height too costs ~130px of page and buys a row band the name
         * comfortably fits, which is also what lets the axis turn on
         * `hideOverlap` as a safety net without it culling rows that were
         * never in trouble.
         *
         * `ganttHeight` still clamps to the floor, so a facet that narrows
         * this to four newspapers gets the panel's min-height, not a stub.
         *
         * `resize()` is what makes ECharts re-lay the canvas into the new box
         * — the ResizeObserver in registerChart also catches this, but only
         * after its 150ms debounce, which shows as a visible squash-then-
         * settle on an 84-row expansion.
         */
        function applyHeight(rowCount) {
            var visible = disclosure.isExpanded()
                ? rowCount
                : Math.min(rowCount, WINDOW_SIZE);
            panelEl.chart.style.height = C.ganttHeight(visible) + 'px';
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var rows = filtered();
            paintKey(rows);
            if (rows.length === 0) {
                instance.clear();
            } else {
                applyHeight(rows.length);
                instance.resize();
                instance.setOption(optionFor(rows), true);
            }
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var rows = filtered();
                disclosure.update(rows.length);
                paintKey(rows);
                if (rows.length === 0) {
                    chart.clear();
                    panelEl.chart.style.height = '';
                } else {
                    applyHeight(rows.length);
                    chart.resize();
                    chart.setOption(optionFor(rows), true);
                }
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.gantt = { render: render };
})();
