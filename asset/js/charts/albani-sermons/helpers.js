/**
 * IWAC Visualizations — Albani Zaria sermons: shared helpers.
 *
 * Stateless builders the section modules share: the lazy section loader,
 * the 20-minute window link, the log-ratio bar chart (collocates and
 * keyness), rates and labels. Everything hangs off `ns.albaniSermons`.
 *
 * Depends on: panels.js (P), chart-options*.js (C), dashboard-core.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.albaniSermons/helpers: missing panels or chartOptions');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons = ns.albaniSermons || {};

    /** Every bundle sits in one directory of the data release. */
    A.DIR = 'albani-sermons/';
    A.SCOPES = ['all', 'monologue'];

    A.lang = function () {
        return ns.locale === 'fr' ? 'fr' : 'en';
    };

    /** `obj.label_fr` on the French site, `obj.label_en` otherwise. */
    A.label = function (obj, base) {
        if (!obj) return '';
        return obj[base + '_' + A.lang()] || obj[base + '_en'] || '';
    };

    A.per10k = function (n, words) {
        return words ? (n / words) * 10000 : 0;
    };

    /**
     * One promise per bundle, shared by every section that reads it — the
     * youth and politics sections both need collocates and the network.
     */
    A.fetcher = function (ctx) {
        var cache = {};
        return function (name) {
            if (!cache[name]) {
                cache[name] = P.fetchJSON(ctx.dataBase + A.DIR + name,
                    { timeoutMs: P.FETCH_TIMEOUT_MS });
            }
            return cache[name];
        };
    };

    /**
     * Fetch a section's bundles when it nears the viewport, then build it.
     * A failed fetch shows the shared error state in that section only.
     */
    A.lazy = function (host, load, build) {
        var spinner = P.buildLoadingState();
        host.appendChild(spinner);
        P.lazyInit(host, function () {
            Promise.resolve()
                .then(load)
                .then(function (data) {
                    if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                    build(data);
                })
                .catch(function (err) {
                    console.error('IWACVis.albaniSermons:', err);
                    if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                    host.appendChild(P.buildFetchErrorState(err));
                });
        });
    };

    /** One exhibition section: heading, curatorial lead, then its panels. */
    A.section = function (root, key, heading, intro) {
        var section = P.el('section', 'iwac-vis-albani__section');
        section.setAttribute('data-iwac-section', key);
        var h = P.el('h3', 'iwac-vis-section-heading', heading);
        h.id = 'iwac-vis-albani-' + key + '-' + Math.random().toString(36).slice(2, 7);
        section.setAttribute('aria-labelledby', h.id);
        section.appendChild(h);
        if (intro) section.appendChild(P.el('p', 'iwac-vis-albani__lead', intro));
        root.appendChild(section);
        return section;
    };

    /**
     * A provenance badge: machine transcription, seed lexicon, heuristic.
     * Machine-derived results get explicit treatment, as `.property--ai`
     * does in the theme, so they are never read as archival metadata.
     */
    A.badge = function (text, hint) {
        var badge = P.el('span', 'iwac-vis-albani__badge', text);
        if (hint) badge.title = hint;
        return badge;
    };

    A.note = function (text, className) {
        return P.el('p', 'iwac-vis-albani__note' + (className ? ' ' + className : ''), text);
    };

    A.itemHref = function (ctx, oId, fallback) {
        if (ctx && ctx.siteBase) return P.itemUrl(ctx.siteBase, oId);
        return fallback || '';
    };

    function clock(seconds) {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    /** `00:40–01:00`, `02:20–end`: the window, never a quotation time. */
    A.windowLabel = function (start, end) {
        return clock(start || 0) + '–' + (end == null ? 'end' : clock(end));
    };

    /**
     * The media file at the window's start, or the item page when the
     * generator could not read the item's IIIF manifest.
     */
    A.windowHref = function (ctx, item, part, start) {
        var media = (item && item.m) ? item.m[part - 1] : null;
        if (media) return media + '#t=' + (start || 0);
        return A.itemHref(ctx, item && item.o, item && item.u);
    };

    /** Bar-chart height for `n` rows, so a long list stays readable. */
    A.sizeFor = function (chartEl, n, row, floor) {
        chartEl.style.height = Math.max(floor || 220, n * (row || 26) + 64) + 'px';
    };

    /**
     * Horizontal bars of log₂ rate ratio, one per term — the effect size
     * the generator ranks by. G² is the significance gate there, and
     * plotting it instead would only rank the corpus's commonest words.
     *
     * @param {Array<Object>} terms  {w, lr, ratio, n, …}
     * @param {Object} opts
     * @param {string} opts.axis      axis name
     * @param {function(Object):string} opts.tooltip  extra tooltip line
     */
    A.logRatioOption = function (terms, opts) {
        opts = opts || {};
        return {
            grid: C._grid({ left: 8, top: 8, bottom: 40, right: 56 }),
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var term = terms[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(term.w || '') + '</strong>'];
                    if (term.ratio != null) lines.push('×' + P.formatDecimal(term.ratio, 1));
                    if (opts.tooltip) lines.push(opts.tooltip(term));
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value', name: opts.axis || '', nameLocation: 'middle', nameGap: 26 },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 150, overflow: 'truncate' },
                data: terms.map(function (t) { return t.w; })
            },
            series: [{
                type: 'bar',
                data: terms.map(function (t) { return t.lr; }),
                barMaxWidth: 18,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) {
                        var term = terms[p.dataIndex] || {};
                        return term.ratio != null ? '×' + P.formatDecimal(term.ratio, 1) : '∞';
                    }
                }
            }]
        };
    };

    /**
     * Build a panel, put it on the page, register its chart, and return a
     * `redraw()` that re-runs the option builder (scope or facet changes).
     */
    A.chartPanel = function (host, title, desc, build, opts) {
        opts = opts || {};
        var built = P.buildPanel('iwac-vis-panel' + (opts.wide ? ' iwac-vis-panel--wide' : ''),
            title, desc, { key: opts.key });
        // Before the chart is registered: ECharts measures its host once, at
        // init, and a class that sets the height afterwards lays the first
        // draw out in the wrong box.
        if (opts.chartClass) built.chart.classList.add(opts.chartClass);
        if (opts.before) {
            opts.before.forEach(function (el) { if (el) built.panel.insertBefore(el, built.chart); });
        }
        host.appendChild(built.panel);
        function draw(chart) {
            // `build` may resize the host to its row count (A.sizeFor), so
            // the instance re-reads its size before the option is laid out.
            var option = build(built);
            chart.resize();
            if (option) chart.setOption(option, true);
            else chart.clear();
        }
        ns.registerChart(built.chart, function (el, chart) { draw(chart); });
        return {
            panel: built.panel,
            chart: built.chart,
            redraw: function () {
                var live = ns.getLiveChart && ns.getLiveChart(built.chart);
                if (live) draw(live);
            }
        };
    };

    /** A labelled `<select>` (shared control skin), options [{value, label}]. */
    A.select = function (label, options, current, onChange, name) {
        return P.buildSelectControl({
            label: label,
            options: options,
            current: current,
            onChange: onChange,
            name: name,
            idPrefix: 'iwac-vis-albani-'
        });
    };

    /** The lexicon entries of one theme, keyed by id. */
    A.entriesById = function (lexicon) {
        var out = {};
        ((lexicon && lexicon.entries) || []).forEach(function (e) { out[e.id] = e; });
        return out;
    };

    A.categoryLabel = function (lexicon, theme, category) {
        var cats = (((lexicon || {}).themes || {})[theme] || {}).categories || [];
        for (var i = 0; i < cats.length; i++) {
            if (cats[i].id === category) return A.label(cats[i], 'label');
        }
        return category;
    };

    /** Recording titles by id, from the metadata bundle. */
    A.recordingsById = function (metadata) {
        var out = {};
        ((metadata && metadata.recordings) || []).forEach(function (r) { out[r.o] = r; });
        return out;
    };
})();
