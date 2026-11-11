/**
 * IWAC Visualizations — Albani Zaria sermons: shared helpers.
 *
 * Stateless builders the section modules share: the lazy section loader,
 * the 20-minute window link, the word scatter (collocates), the
 * recording order every matrix shares, rates and labels. Everything hangs off `ns.albaniSermons`.
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

    /**
     * Whether labels carry their translation — the header's "Translations"
     * switch, mirrored here by the orchestrator before any section draws.
     * Tooltips keep the translation either way.
     */
    A.labelGlosses = true;

    /** The store keys a glossed chart redraws on. */
    A.GLOSS_KEYS = ['scope', 'glosses'];

    A.lang = function () {
        return ns.locale === 'fr' ? 'fr' : 'en';
    };

    /** `obj.label_fr` on the French site, `obj.label_en` otherwise. */
    A.label = function (obj, base) {
        if (!obj) return '';
        return obj[base + '_' + A.lang()] || obj[base + '_en'] || '';
    };

    /**
     * The draft gloss of a non-lexicon word (`term.g`, from
     * scripts/albani/glosses.json) in the page's language, or ''.
     */
    A.gloss = function (term) {
        var g = term && term.g;
        if (!g) return '';
        return g[A.lang()] || g.en || '';
    };

    /** A lexicon entry's gloss in the page's language — the curated one. */
    A.entryGloss = function (entry) {
        return A.label(entry, 'gloss');
    };

    /**
     * The first sense of a gloss, without its note: "émir, roi" from
     * "émir, roi ; sarkin musulmi, le sultan de Sokoto". Labels on an axis
     * or beside a node carry this; tooltips carry the whole gloss.
     */
    A.shortGloss = function (gloss) {
        return String(gloss || '').split(/\s*;\s*/)[0].replace(/\s*\([^)]*\)\s*$/, '');
    };

    /** `term · gloss` for an axis or a list, the term alone when unglossed. */
    A.withGloss = function (word, gloss) {
        return gloss ? word + ' · ' + gloss : word;
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
     * The panel keys each section builds: section key → { name: panel key }.
     *
     * Each section module claims its keys at the top of its file and builds
     * its panels from the same object, so the map and the panels cannot
     * name different keys. The orchestrator reads it to build only the
     * section a single-panel embed needs (`A.sectionOf`), and the browser
     * suite checks the full page against it, so a panel added without a
     * claim fails there rather than embedding the whole block.
     */
    A.PANELS = {};

    /**
     * Claim `keys` for `section` and hand them back, for the section to
     * build its panels from.
     *
     * @param {string} section  the section's `data-iwac-section` key
     * @param {Object<string, string>} keys  name → panel key
     * @returns {Object<string, string>} `keys`
     */
    A.claimPanels = function (section, keys) {
        A.PANELS[section] = keys;
        return keys;
    };

    /** The section that builds panel `key`, or null for a key none claims. */
    A.sectionOf = function (key) {
        if (!key) return null;
        for (var section in A.PANELS) {
            if (!Object.prototype.hasOwnProperty.call(A.PANELS, section)) continue;
            var keys = A.PANELS[section];
            for (var name in keys) {
                if (Object.prototype.hasOwnProperty.call(keys, name) && keys[name] === key) return section;
            }
        }
        return null;
    };

    /** Every panel key a section claims, as a list. */
    function panelsOf(section) {
        var keys = A.PANELS[section] || {};
        return Object.keys(keys).map(function (name) { return keys[name]; });
    }

    /**
     * Fetch a section's bundles when it nears the viewport, then build it.
     * A failed fetch shows the shared error state in that section only.
     *
     * The section's claimed panels go to `P.lazyInit`, so a single-panel
     * embed renders this part only when it is looking for one of them.
     */
    A.lazy = function (host, load, build) {
        var spinner = P.buildLoadingState();
        host.appendChild(spinner);
        var section = host.closest ? host.closest('[data-iwac-section]') : null;
        var key = section ? section.getAttribute('data-iwac-section') : '';
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
        }, A.PANELS[key] ? { panels: panelsOf(key) } : undefined);
    };

    /** One exhibition section: heading, curatorial lead, then its panels. */
    A.section = function (root, key, heading, intro) {
        var section = P.el('section', 'iwac-vis-albani__section');
        section.setAttribute('data-iwac-section', key);
        var h = P.el('h3', 'iwac-vis-section-heading', heading);
        // A stable id, so a section can be linked from outside the page
        // (#albani-score); a suffix only when the page holds two blocks.
        h.id = 'albani-' + key;
        if (document.getElementById(h.id)) h.id += '-' + Math.random().toString(36).slice(2, 7);
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

    /** `00:40–01:00`, `02:20–end`: the segment, never a quotation time. */
    A.windowLabel = function (start, end) {
        return clock(start || 0) + '–' + (end == null ? P.t('albani_window_end') : clock(end));
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

    /**
     * Bar-chart height for `n` rows, so a long list stays readable. A
     * MINIMUM height: an inline `height` would outrank the shared
     * full-screen rule (iwac-core.css), and the expanded chart would keep
     * its page size inside a full-screen panel.
     */
    A.sizeFor = function (chartEl, n, row, floor) {
        chartEl.style.minHeight = Math.max(floor || 220, n * (row || 26) + 64) + 'px';
    };

    /**
     * Words on two axes: how often (x, log) and how distinctive (y, log₂
     * rate ratio — the effect size the generator ranks by), each point
     * labelled with its word, so the standouts read without a legend. It
     * replaces a ranked bar list, which showed only the second axis and
     * hid that a ×50 word heard five times and a ×5 word heard fifty are
     * different findings. G² is the significance gate in the generator;
     * plotting it would only rank the commonest words.
     *
     * @param {Array<Object>} terms  {w, lr, ratio, n, r, …}
     * @param {Object} opts
     * @param {string} opts.xName   x axis name
     * @param {string} opts.yName   y axis name
     * @param {function(Object):string} opts.tooltip  extra tooltip line
     */
    /** ECharts rich text reads `{`, `}` and `|` as markup. */
    function richSafe(text) {
        return String(text).replace(/[{}|]/g, ' ');
    }

    A.wordScatterOption = function (terms, opts) {
        opts = opts || {};
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var maxR = 1;
        terms.forEach(function (t) { if ((t.r || 0) > maxR) maxR = t.r; });
        return {
            grid: C._grid({ left: 8, top: 36, bottom: 44, right: 72 }),
            tooltip: C._inPanelTooltip({
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var term = terms[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(term.w || '') + '</strong>'];
                    var gloss = A.gloss(term);
                    if (gloss) lines.push('<em>' + P.escapeHtml(gloss) + '</em>');
                    lines.push(term.ratio != null ? '×' + P.formatDecimal(term.ratio, 1) : '∞');
                    if (opts.tooltip) lines.push(opts.tooltip(term));
                    return lines.join('<br>');
                }
            }),
            xAxis: {
                type: 'log',
                logBase: 10,
                name: opts.xName || '',
                nameLocation: 'middle',
                nameGap: 28,
                splitLine: { show: false },
                axisLabel: { formatter: function (v) { return P.formatNumber(v); } }
            },
            yAxis: {
                type: 'value',
                name: opts.yName || '',
                nameLocation: 'end',
                nameGap: 14,
                nameTextStyle: { align: 'left' },
                min: function (v) { return Math.max(0, Math.floor(v.min) - 1); },
                // The ratio itself on the axis, not its log: ×2, ×4, ×8.
                axisLabel: { formatter: function (v) { return '×' + P.formatNumber(Math.pow(2, v)); } }
            },
            series: [{
                type: 'scatter',
                data: terms.map(function (t) { return [Math.max(1, t.n), t.lr]; }),
                symbolSize: function (v, p) {
                    var r = (terms[p.dataIndex] || {}).r || 1;
                    return 7 + 9 * Math.sqrt(r / maxR);
                },
                itemStyle: {
                    color: tokens.primary,
                    opacity: 0.85,
                    borderColor: tokens.panelBg || tokens.surface,
                    borderWidth: 1
                },
                // The word, and under it its draft gloss in the page's
                // language: the reader of the French site reads French.
                label: {
                    show: true,
                    position: 'right',
                    distance: 4,
                    formatter: function (p) {
                        var term = terms[p.dataIndex] || {};
                        var gloss = A.labelGlosses ? A.shortGloss(A.gloss(term)) : '';
                        return '{w|' + richSafe(term.w || '') + '}'
                            + (gloss ? '\n{g|' + richSafe(gloss) + '}' : '');
                    },
                    rich: {
                        w: { fontSize: P.AXIS_FONT_SM + 1, color: tokens.ink, lineHeight: 15 },
                        g: { fontSize: P.AXIS_FONT_SM, color: tokens.muted, lineHeight: 13, fontStyle: 'italic' }
                    }
                },
                labelLayout: { hideOverlap: true },
                emphasis: { focus: 'self', label: { fontWeight: 'bold' } }
            }]
        };
    };

    /**
     * The analysed recordings in reading order — dated ones first, oldest
     * first, then the undated by title. Every recording-by-something view
     * (the score, the profiles, the formula strips, the signature cards)
     * reads its rows from here, so a recording keeps its place from one
     * view to the next.
     */
    A.recordingOrder = function (metadata) {
        return ((metadata && metadata.recordings) || [])
            .filter(function (r) { return r.st === 'analysed'; })
            .sort(function (a, b) {
                if (!!a.d !== !!b.d) return a.d ? -1 : 1;
                return String(a.d || '').localeCompare(String(b.d || ''))
                    || String(a.t || '').localeCompare(String(b.t || ''));
            });
    };

    /** `Title (2008)`, the row label of every recording-by-something view. */
    A.recordingLabel = function (rec) {
        if (!rec) return '';
        return rec.y ? rec.t + ' (' + rec.y + ')' : rec.t;
    };

    /** Words a recording contributes to a scope. */
    A.scopeWords = function (rec, scope) {
        if (!rec) return 0;
        return scope === 'monologue' ? (rec.wm || 0) : (rec.w || 0);
    };

    /**
     * Piecewise bins at the quintiles of `values` (the non-zero cells,
     * rounded to one decimal), for a matrix whose cells span orders of
     * magnitude: on a linear ramp one sermon on jihad at 60 per 10,000
     * painted every other cell near the empty tint. Duplicate edges
     * collapse, so a sparse matrix gets fewer bins rather than empty ones.
     */
    A.quantileBins = function (values) {
        var sorted = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
        if (!sorted.length) return [];
        var edges = [sorted[0]];
        [0.2, 0.4, 0.6, 0.8].forEach(function (q) {
            var v = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
            if (v > edges[edges.length - 1]) edges.push(v);
        });
        return edges.map(function (min, i) {
            var next = edges[i + 1];
            if (next == null) return { min: min, label: P.formatDecimal(min, 1) + '+' };
            var max = Math.round((next - 0.1) * 10) / 10;
            return { min: min, max: max, label: max > min
                ? P.formatDecimal(min, 1) + '–' + P.formatDecimal(max, 1) : P.formatDecimal(min, 1) };
        });
    };

    /**
     * The empty cells of a matrix as their own series, in the ramp's first
     * (empty-cell) tint, outside the visualMap — so a zero reads as "none"
     * and the bins start at the first real value.
     */
    A.emptyCellSeries = function (name, cells) {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        return {
            type: 'heatmap',
            name: name,
            data: cells,
            progressive: 0,
            animation: false,
            itemStyle: { color: ns.heatmapRamp()[0], borderColor: tokens.surface, borderWidth: 1 }
        };
    };

    /**
     * Width for a matrix's recording titles: 200px where there is room, a
     * third of the chart on a phone, where 200px left the grid a sliver.
     */
    A.labelWidth = function (chartEl) {
        var width = (chartEl && chartEl.clientWidth) || 800;
        return Math.max(90, Math.min(200, Math.round(width * 0.32)));
    };

    /** Rate bins (per 10,000 words) for the ledger strips, on the
     *  module's heat ramp; 0 is the empty cell. */
    var STRIP_BINS = [1, 4, 10];

    function stripBin(rate) {
        if (!rate) return 0;
        for (var i = 0; i < STRIP_BINS.length; i++) {
            if (rate < STRIP_BINS[i]) return i + 1;
        }
        return STRIP_BINS.length + 1;
    }

    /**
     * One cell per recording (in `recs` order), shaded by the item's rate
     * there: the strip the formula and name ledgers share. Decorative for
     * assistive technology — the row states the count and the spread.
     *
     * @param {Object} byRec  {o_id: count}
     */
    A.rateStrip = function (byRec, recs, scope) {
        var strip = P.el('span', 'iwac-vis-albani__strip');
        strip.setAttribute('aria-hidden', 'true');
        recs.forEach(function (r) {
            var n = (byRec || {})[r.o] || 0;
            var rate = A.per10k(n, A.scopeWords(r, scope));
            var cell = P.el('span', 'iwac-vis-albani__strip-cell iwac-vis-albani__strip-cell--' + stripBin(rate));
            cell.title = A.recordingLabel(r) + ' — ' + P.t('albani_formulae_cell', {
                count: n, rate: P.formatDecimal(rate, 1) });
            strip.appendChild(cell);
        });
        return strip;
    };

    /** Height for a recording-by-something matrix of `rows` rows. */
    A.matrixHeight = function (chartEl, rows, row, extra) {
        chartEl.style.minHeight = Math.max(260, rows * (row || 22) + (extra || 110)) + 'px';
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
            if (!option) { chart.clear(); return; }
            // Every chart here sits in a panel with a full-screen control, and
            // a <body> tooltip renders behind the full-screen layer. The shared
            // bar and word-cloud builders leave theirs in <body>, so the panel
            // moves it in-panel, whatever builder made the option (a
            // media-query option keeps it under `baseOption`).
            var target = option.baseOption || option;
            if (target.tooltip) target.tooltip = C._inPanelTooltip(target.tooltip);
            chart.setOption(option, true);
        }
        ns.registerChart(built.chart, function (el, chart) {
            draw(chart);
            // Unbound first: a theme swap re-runs this callback on the same
            // instance, and a bare .on() would stack a listener per swap.
            if (opts.onClick) {
                chart.off('click');
                chart.on('click', opts.onClick);
            }
        });
        // The shared full-screen control, after the download and table
        // buttons registerChart attached, as on every other chart panel.
        P.addFullscreenButton(built.panel, {
            onResize: function () {
                var live = ns.getLiveChart && ns.getLiveChart(built.chart);
                if (live) live.resize();
            }
        });
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
