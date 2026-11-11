/**
 * IWAC Visualizations — windowed Gantt (shared)
 *
 * The span chart three blocks draw — the newspaper coverage Gantt
 * (collection-overview/gantt.js), the index activity Gantt
 * (index-overview/activity-gantt.js) and the periodical runs Gantt
 * (periodicals-overview.js) — with its row window stated and escapable:
 * a `P.buildWindowDisclosure` note above the chart, `C.gantt` drawn
 * collapsed or expanded to match it, and the host sized to the rows on
 * screen.
 *
 * Lives in the `charts` shared bundle because it needs `C.gantt` /
 * `C.ganttHeight`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildWindowDisclosure || !C.gantt) {
        console.warn('IWACVis.windowed-gantt: missing dependencies');
        return;
    }

    /**
     * Build the disclosure, register the chart, and keep the two in step.
     *
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
     * `resize()` before `setOption` is what makes ECharts re-lay the canvas
     * into the new box at once — the ResizeObserver in registerChart also
     * catches this, but only after its 150ms debounce, which shows as a
     * visible squash-then-settle on an 84-row expansion.
     *
     * The render runs on first paint, on every theme swap and on a compact
     * flip (registerChart), and on `redraw()` / `update()`.
     *
     * @param {Object} cfg
     * @param {HTMLElement} cfg.host        the chart element
     * @param {HTMLElement} [cfg.panel]     where the disclosure goes (inserted
     *   just before `host`); omitted, the caller places `disclosure.root`
     * @param {function(): Array} cfg.rows  the rows to draw now
     * @param {number} [cfg.windowSize=20]
     * @param {string} [cfg.noteKey]        see P.buildWindowDisclosure
     * @param {string} [cfg.allKey]
     * @param {string} [cfg.showTopKey]
     * @param {function(Array, boolean): Object} [cfg.optionFor]  the option for
     *   (rows, expanded); default `C.gantt` with the window
     * @param {function(): number} [cfg.extraHeight]  px added under the rows
     *   (a legend the option draws below the axis)
     * @param {function(Array): void} [cfg.onRender]  runs before each draw with
     *   the rows (a key built from them)
     * @returns {{chart: (echarts.ECharts|null), redraw: function(): void,
     *            update: function(): void, disclosure: Object}}
     *   `redraw()` repaints; `update()` first re-counts the rows for the
     *   disclosure (after a facet changed them), then repaints.
     */
    P.buildWindowedGantt = function (cfg) {
        var windowSize = cfg.windowSize || 20;
        var host = cfg.host;
        var chart = null;

        var disclosure = P.buildWindowDisclosure({
            windowSize: windowSize,
            total:      cfg.rows().length,
            noteKey:    cfg.noteKey,
            allKey:     cfg.allKey,
            showTopKey: cfg.showTopKey,
            onToggle:   function () { redraw(); }
        });
        if (cfg.panel) cfg.panel.insertBefore(disclosure.root, host);

        function optionFor(rows) {
            var expanded = disclosure.isExpanded();
            if (cfg.optionFor) return cfg.optionFor(rows, expanded);
            return C.gantt(rows, { windowSize: windowSize, expanded: expanded });
        }

        function draw(instance) {
            var rows = cfg.rows();
            if (cfg.onRender) cfg.onRender(rows);
            if (rows.length === 0) {
                instance.clear();
                host.style.height = '';
                return;
            }
            var visible = disclosure.isExpanded()
                ? rows.length
                : Math.min(rows.length, windowSize);
            var extra = cfg.extraHeight ? cfg.extraHeight() : 0;
            host.style.height = (C.ganttHeight(visible) + extra) + 'px';
            instance.resize();
            instance.setOption(optionFor(rows), true);
        }

        function redraw() {
            if (chart && !chart.isDisposed()) draw(chart);
        }

        chart = ns.registerChart(host, function (el, instance) { draw(instance); });

        return {
            chart: chart,
            disclosure: disclosure,
            redraw: redraw,
            update: function () {
                disclosure.update(cfg.rows().length);
                redraw();
            }
        };
    };
})();
