/**
 * IWAC Visualizations — Scary Terms block: stateless builders.
 *
 * Split out of scary-terms.js. These are pure (data in → DOM/value out)
 * and hang off IWACVis.scaryTerms; the orchestrator aliases them locally.
 * The stateful render closure (view/playback/matrix) stays in the
 * orchestrator because it is tightly coupled to per-block instance state.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms helpers: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    /**
     * Build a stable ``{term_family: color}`` map from the registered IWAC
     * ECharts palette. The palette is theme-aware (dark / light) and starts
     * with --primary in slot 0, so every term family inherits colors from
     * the active theme without any hardcoded hex.
     */
    function buildTermColorMap(families) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var tokens = ns.getChartTokens && ns.getChartTokens();
        var fallback = (tokens && tokens.primary) || '';
        var map = {};
        families.forEach(function (family, idx) {
            map[family] = palette[idx % palette.length] || fallback;
        });
        return map;
    }

    function buildMetricCards(metadata, globalData) {
        var grid = P.el('div', 'iwac-vis-scary-metrics');
        function card(labelKey, value) {
            var cardEl = P.el('div', 'iwac-vis-summary-card');
            cardEl.appendChild(P.el('span', 'iwac-vis-summary-card__value',
                                    P.formatNumber(value || 0)));
            cardEl.appendChild(P.el('span', 'iwac-vis-summary-card__label',
                                    P.t(labelKey)));
            return cardEl;
        }
        var families = metadata.term_families || [];
        grid.appendChild(card('scary.total_articles',    metadata.total_articles));
        grid.appendChild(card('scary.term_families',     metadata.term_families_count || families.length));
        grid.appendChild(card('scary.term_variants',     metadata.total_variants));
        grid.appendChild(card('scary.total_occurrences', (globalData && globalData.total_occurrences) || 0));
        return grid;
    }

    function buildTermDefinitions(metadata) {
        var wrap = P.el('div', 'iwac-vis-scary-defs');
        wrap.appendChild(P.el('h4', 'iwac-vis-scary-defs-title',
                              P.t('scary.term_definitions')));
        var grid = P.el('div', 'iwac-vis-scary-defs-grid');
        var defs = metadata.term_definitions || {};
        Object.keys(defs).forEach(function (family) {
            var cardEl = P.el('div', 'iwac-vis-scary-def-card');
            cardEl.appendChild(P.el('h5', 'iwac-vis-scary-def-title', family));
            var tags = P.el('div', 'iwac-vis-scary-def-tags');
            (defs[family] || []).forEach(function (variant) {
                tags.appendChild(P.el('span', 'iwac-vis-scary-def-tag', variant));
            });
            cardEl.appendChild(tags);
            grid.appendChild(cardEl);
        });
        wrap.appendChild(grid);
        return wrap;
    }

    /**
     * Pre-compute one sorted ``[[term, count], ...]`` snapshot per year.
     * Snapshot ``i`` is the **cumulative** sum of counts from
     * ``years[0]`` through ``years[i]`` — matching the iwac-dashboard
     * bar chart race semantics where bars grow monotonically over time
     * (running totals, not year-over-year counts).
     */
    function buildCumulativeSnapshots(temporal, years) {
        var snapshots = [];
        var running = {};
        for (var i = 0; i < years.length; i++) {
            var pairs = (temporal[String(years[i])] || {}).data || [];
            for (var j = 0; j < pairs.length; j++) {
                var term = pairs[j][0];
                running[term] = (running[term] || 0) + pairs[j][1];
            }
            var snapshot = Object.keys(running).map(function (k) {
                return [k, running[k]];
            }).sort(function (a, b) { return b[1] - a[1]; });
            snapshots.push(snapshot);
        }
        return snapshots;
    }

    S.buildTermColorMap = buildTermColorMap;
    S.buildMetricCards = buildMetricCards;
    S.buildTermDefinitions = buildTermDefinitions;
    S.buildCumulativeSnapshots = buildCumulativeSnapshots;
})();
