/**
 * IWAC Visualizations — Compare Newspapers block (orchestrator)
 *
 * Two-side comparison UI. Each side (A, B) picks:
 *   - type:  articles | publications
 *   - scope: country  | newspaper
 *   - name:  the specific country or newspaper from the index
 *
 * Data:
 *   asset/data/compare-newspapers/index.json
 *   asset/data/compare-newspapers/<type>/(country|newspaper)-<slug>.json
 *
 * Panels rendered when both sides are loaded:
 *   1. Metrics row (side-by-side values per metric)
 *   2. Timeline — overlapping line chart
 *   3. Subject overlap — shared / only-A / only-B tag columns
 *   4. Spatial overlap — same structure
 *   5. Wordclouds — side by side (uses echarts-wordcloud)
 *   6. Top subjects bar chart (side by side)
 *   7. Newspapers breakdown (only when at least one side is country-scope)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers: missing panels — check script load order');
        return;
    }
    var P = ns.panels;

    var SIDES = ['A', 'B'];
    var DEFAULT_TOP_OVERLAP = 12;


    /* ----------------------------------------------------------------- */
    /*  Data loading                                                      */
    /* ----------------------------------------------------------------- */

    function indexUrl(basePath) {
        return basePath + '/modules/IwacVisualizations/asset/data/compare-newspapers/index.json';
    }

    function corpusUrl(basePath, type, scope, slug) {
        return basePath + '/modules/IwacVisualizations/asset/data/compare-newspapers/'
            + type + '/' + scope + '-' + slug + '.json';
    }

    function fetchJson(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + url);
            return r.json();
        });
    }


    /* ----------------------------------------------------------------- */
    /*  Picker UI                                                         */
    /* ----------------------------------------------------------------- */

    function buildPicker(side, index, defaults, onChange) {
        var state = {
            type: defaults.type,
            scope: defaults.scope,
            slug: defaults.slug
        };

        var card = P.el('div', 'iwac-vis-compare-picker');
        card.dataset.side = side;

        var eyebrow = P.el('div', 'iwac-vis-compare-picker__eyebrow',
            P.t(side === 'A' ? 'Corpus A' : 'Corpus B'));
        card.appendChild(eyebrow);

        // --- Type switch (articles / publications) -------------------
        var typeRow = P.el('div', 'iwac-vis-compare-picker__row');
        typeRow.appendChild(P.el('span', 'iwac-vis-compare-picker__label', P.t('Type')));
        var typeBar = P.el('div', 'iwac-vis-compare-picker__type');
        var typeButtons = {};
        ['articles', 'publications'].forEach(function (key) {
            var btn = P.el('button', null,
                P.t(key === 'articles' ? 'Newspaper articles' : 'Islamic publications'));
            btn.type = 'button';
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', function () {
                if (state.type === key) return;
                state.type = key;
                // After a type swap, fall back to the first scope with options.
                var subset = index.subsets && index.subsets[state.type];
                if (subset) {
                    if (state.scope === 'country' && !(subset.countries || []).length) {
                        state.scope = 'newspapers';
                    }
                    if (state.scope === 'newspaper' && !(subset.newspapers || []).length) {
                        state.scope = 'country';
                    }
                }
                rebuildScope();
                rebuildName();
                fire();
                refreshButtons();
            });
            typeButtons[key] = btn;
            typeBar.appendChild(btn);
        });
        typeRow.appendChild(typeBar);
        card.appendChild(typeRow);

        // --- Scope switch (country / newspaper) ----------------------
        var scopeRow = P.el('div', 'iwac-vis-compare-picker__row');
        scopeRow.appendChild(P.el('span', 'iwac-vis-compare-picker__label', P.t('Scope')));
        var scopeSelect = P.el('select', 'iwac-vis-compare-picker__select');
        scopeSelect.addEventListener('change', function () {
            state.scope = scopeSelect.value;
            rebuildName();
            fire();
        });
        scopeRow.appendChild(scopeSelect);
        card.appendChild(scopeRow);

        // --- Name dropdown (country / newspaper name) ----------------
        var nameRow = P.el('div', 'iwac-vis-compare-picker__row');
        nameRow.appendChild(P.el('span', 'iwac-vis-compare-picker__label', P.t('Selection')));
        var nameSelect = P.el('select', 'iwac-vis-compare-picker__select');
        nameSelect.addEventListener('change', function () {
            state.slug = nameSelect.value;
            fire();
        });
        nameRow.appendChild(nameSelect);
        card.appendChild(nameRow);

        function refreshButtons() {
            Object.keys(typeButtons).forEach(function (k) {
                typeButtons[k].setAttribute(
                    'aria-pressed', k === state.type ? 'true' : 'false');
            });
        }

        function rebuildScope() {
            scopeSelect.innerHTML = '';
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) return;
            var available = [];
            if ((subset.countries || []).length) available.push('country');
            if ((subset.newspapers || []).length) available.push('newspaper');
            available.forEach(function (s) {
                var opt = P.el('option', null,
                    P.t(s === 'country' ? 'Whole country' : 'Single newspaper'));
                opt.value = s;
                scopeSelect.appendChild(opt);
            });
            if (available.indexOf(state.scope) === -1) {
                state.scope = available[0] || 'country';
            }
            scopeSelect.value = state.scope;
        }

        function rebuildName() {
            nameSelect.innerHTML = '';
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) return;
            var list = state.scope === 'country'
                ? (subset.countries || [])
                : (subset.newspapers || []);
            list.forEach(function (entry) {
                var label = entry.name + ' (' + P.formatNumber(entry.count) + ')';
                if (entry.country && state.scope === 'newspaper') {
                    label = entry.name + ' — ' + entry.country + ' (' + P.formatNumber(entry.count) + ')';
                }
                var opt = P.el('option', null, label);
                opt.value = entry.slug;
                nameSelect.appendChild(opt);
            });
            var slugs = list.map(function (e) { return e.slug; });
            if (slugs.indexOf(state.slug) === -1) {
                state.slug = slugs[0] || null;
            }
            if (state.slug) nameSelect.value = state.slug;
        }

        function fire() {
            if (typeof onChange === 'function' && state.slug) {
                onChange({ type: state.type, scope: state.scope, slug: state.slug });
            }
        }

        rebuildScope();
        rebuildName();
        refreshButtons();

        return {
            root: card,
            getState: function () { return { type: state.type, scope: state.scope, slug: state.slug }; }
        };
    }


    /* ----------------------------------------------------------------- */
    /*  Metrics row                                                       */
    /* ----------------------------------------------------------------- */

    function buildMetrics(dataA, dataB) {
        var grid = P.el('div', 'iwac-vis-compare-metrics');

        var metrics = [
            { labelKey: 'Total items',       pick: function (d) { return d.summary.total_items; }, numeric: true },
            { labelKey: 'Total words',       pick: function (d) { return d.summary.total_words; }, numeric: true },
            { labelKey: 'Period covered',    pick: function (d) {
                if (d.summary.year_min && d.summary.year_max) {
                    return d.summary.year_min + ' – ' + d.summary.year_max;
                }
                return '—';
            }, numeric: false },
            { labelKey: 'Unique subjects',   pick: function (d) { return d.summary.unique_subjects; }, numeric: true },
            { labelKey: 'Places mentioned',  pick: function (d) { return d.summary.unique_spatial; }, numeric: true },
            { labelKey: 'Newspapers',        pick: function (d) { return d.summary.unique_newspapers; }, numeric: true },
            { labelKey: 'Languages',         pick: function (d) { return d.summary.unique_languages; }, numeric: true },
            { labelKey: 'Total pages',       pick: function (d) { return d.summary.total_pages; }, numeric: true, skipIfZero: true }
        ];

        metrics.forEach(function (m) {
            var vA = m.pick(dataA);
            var vB = m.pick(dataB);
            if (m.skipIfZero && !vA && !vB) return;

            var card = P.el('div', 'iwac-vis-compare-metric');
            card.appendChild(P.el('div', 'iwac-vis-compare-metric__label', P.t(m.labelKey)));
            var pair = P.el('div', 'iwac-vis-compare-metric__pair');
            var a = P.el('div', 'iwac-vis-compare-metric__value',
                m.numeric ? P.formatNumber(vA || 0) : String(vA));
            a.dataset.side = 'A';
            a.title = dataA.name;
            var b = P.el('div', 'iwac-vis-compare-metric__value',
                m.numeric ? P.formatNumber(vB || 0) : String(vB));
            b.dataset.side = 'B';
            b.title = dataB.name;
            pair.appendChild(a);
            pair.appendChild(b);
            card.appendChild(pair);
            grid.appendChild(card);
        });

        return grid;
    }


    /* ----------------------------------------------------------------- */
    /*  Overlap columns (shared / only-A / only-B)                        */
    /* ----------------------------------------------------------------- */

    function computeOverlap(listA, listB, topN) {
        var mapA = {};
        var mapB = {};
        (listA || []).forEach(function (e) { mapA[e.name] = e.count; });
        (listB || []).forEach(function (e) { mapB[e.name] = e.count; });

        var shared = [];
        var onlyA = [];
        var onlyB = [];

        Object.keys(mapA).forEach(function (name) {
            if (Object.prototype.hasOwnProperty.call(mapB, name)) {
                shared.push({ name: name, countA: mapA[name], countB: mapB[name],
                              combined: mapA[name] + mapB[name] });
            } else {
                onlyA.push({ name: name, count: mapA[name] });
            }
        });
        Object.keys(mapB).forEach(function (name) {
            if (!Object.prototype.hasOwnProperty.call(mapA, name)) {
                onlyB.push({ name: name, count: mapB[name] });
            }
        });

        shared.sort(function (a, b) { return b.combined - a.combined; });
        onlyA.sort(function (a, b) { return b.count - a.count; });
        onlyB.sort(function (a, b) { return b.count - a.count; });

        return {
            shared: shared.slice(0, topN),
            onlyA: onlyA.slice(0, topN),
            onlyB: onlyB.slice(0, topN),
            sharedTotal: shared.length,
            onlyATotal: onlyA.length,
            onlyBTotal: onlyB.length
        };
    }

    function buildOverlapList(items, kind) {
        var ul = P.el('ul', 'iwac-vis-compare-overlap__list');
        items.forEach(function (item) {
            var li = P.el('li', 'iwac-vis-compare-overlap__tag');
            li.appendChild(P.el('strong', null, item.name));
            if (kind === 'shared') {
                var sep = P.el('span', null, ' · ' +
                    P.formatNumber(item.countA) + ' / ' + P.formatNumber(item.countB));
                li.appendChild(sep);
            } else {
                li.appendChild(P.el('span', null, ' · ' + P.formatNumber(item.count)));
            }
            ul.appendChild(li);
        });
        return ul;
    }

    function buildOverlapPanel(titleKey, listA, listB, dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t(titleKey)));
        var grid = P.el('div', 'iwac-vis-compare-overlap');
        panel.appendChild(grid);

        var overlap = computeOverlap(listA, listB, DEFAULT_TOP_OVERLAP);

        function makeCol(kind, titleText, total, items) {
            var col = P.el('div', 'iwac-vis-compare-overlap__col');
            col.dataset.kind = kind;
            var title = P.el('div', 'iwac-vis-compare-overlap__title', titleText);
            var count = P.el('span', 'iwac-vis-compare-overlap__count',
                ' \u00b7 ' + P.formatNumber(total));
            title.appendChild(count);
            col.appendChild(title);
            if (items.length === 0) {
                col.appendChild(P.el('div', 'iwac-vis-compare-overlap__empty',
                    P.t('No overlap')));
            } else {
                col.appendChild(buildOverlapList(items, kind));
            }
            return col;
        }

        grid.appendChild(makeCol('only-a',
            P.t('Only in A', { name: dataA.name }),
            overlap.onlyATotal, overlap.onlyA));
        grid.appendChild(makeCol('shared',
            P.t('Shared'), overlap.sharedTotal, overlap.shared));
        grid.appendChild(makeCol('only-b',
            P.t('Only in B', { name: dataB.name }),
            overlap.onlyBTotal, overlap.onlyB));

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Timeline (overlapping line chart)                                 */
    /* ----------------------------------------------------------------- */

    function buildTimeline(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Timeline (items per year)')));
        var host = P.el('div', 'iwac-vis-chart');
        panel.appendChild(host);

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var colorA = tokens.primary || '#d86a11';
        var colorB = '#1d4e6b';

        var yearSet = {};
        (dataA.timeline.years || []).forEach(function (y) { yearSet[y] = true; });
        (dataB.timeline.years || []).forEach(function (y) { yearSet[y] = true; });
        var years = Object.keys(yearSet).map(Number).sort(function (a, b) { return a - b; });

        function toSeries(d) {
            var yearToCount = {};
            (d.timeline.years || []).forEach(function (y, i) {
                yearToCount[y] = d.timeline.counts[i];
            });
            return years.map(function (y) { return yearToCount[y] || 0; });
        }

        ns.registerChart(host, function (el, instance) {
            instance.setOption({
                grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
                tooltip: { trigger: 'axis' },
                legend: { top: 4, itemWidth: 14, itemHeight: 10 },
                xAxis: {
                    type: 'category',
                    data: years,
                    name: P.t('Year'),
                    nameLocation: 'middle',
                    nameGap: 28
                },
                yAxis: { type: 'value', name: P.t('Count') },
                dataZoom: years.length > 30
                    ? [{ type: 'slider', start: 0, end: 100, bottom: 8, height: 18 },
                       { type: 'inside' }]
                    : [],
                series: [
                    {
                        name: dataA.name,
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: { width: 2, color: colorA },
                        itemStyle: { color: colorA },
                        areaStyle: { color: colorA, opacity: 0.18 },
                        data: toSeries(dataA)
                    },
                    {
                        name: dataB.name,
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: { width: 2, color: colorB },
                        itemStyle: { color: colorB },
                        areaStyle: { color: colorB, opacity: 0.18 },
                        data: toSeries(dataB)
                    }
                ],
                animationDuration: 600,
                animationEasing: 'cubicOut'
            });
        });

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Top-subjects bar chart (grouped)                                  */
    /* ----------------------------------------------------------------- */

    function buildTopSubjects(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Top subjects (combined top 15)')));
        var host = P.el('div', 'iwac-vis-chart');
        panel.appendChild(host);

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var colorA = tokens.primary || '#d86a11';
        var colorB = '#1d4e6b';

        var mapA = {}, mapB = {};
        (dataA.subjects || []).forEach(function (e) { mapA[e.name] = e.count; });
        (dataB.subjects || []).forEach(function (e) { mapB[e.name] = e.count; });

        var names = {};
        Object.keys(mapA).forEach(function (n) { names[n] = true; });
        Object.keys(mapB).forEach(function (n) { names[n] = true; });
        var allNames = Object.keys(names);
        allNames.sort(function (a, b) {
            return ((mapB[b] || 0) + (mapA[b] || 0)) - ((mapB[a] || 0) + (mapA[a] || 0));
        });
        var top = allNames.slice(0, 15).reverse();  // reverse so largest is at top

        ns.registerChart(host, function (el, instance) {
            instance.setOption({
                grid: { left: 8, right: 48, top: 36, bottom: 8, containLabel: true },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { top: 4, itemWidth: 14, itemHeight: 10 },
                xAxis: { type: 'value' },
                yAxis: {
                    type: 'category',
                    data: top,
                    axisTick: { show: false },
                    axisLabel: { width: 160, overflow: 'truncate' }
                },
                series: [
                    {
                        name: dataA.name,
                        type: 'bar',
                        itemStyle: { color: colorA, borderRadius: [0, 4, 4, 0] },
                        data: top.map(function (n) { return mapA[n] || 0; })
                    },
                    {
                        name: dataB.name,
                        type: 'bar',
                        itemStyle: { color: colorB, borderRadius: [0, 4, 4, 0] },
                        data: top.map(function (n) { return mapB[n] || 0; })
                    }
                ],
                animationDuration: 600,
                animationEasing: 'cubicOut'
            });
        });

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Wordclouds (side by side)                                         */
    /* ----------------------------------------------------------------- */

    function buildWordclouds(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Most frequent words')));
        var wrap = P.el('div', 'iwac-vis-compare-wordclouds');
        panel.appendChild(wrap);

        [['A', dataA], ['B', dataB]].forEach(function (pair) {
            var side = pair[0];
            var data = pair[1];
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', data.name));
            var host = P.el('div', 'iwac-vis-compare-wordcloud__chart');
            col.appendChild(host);
            wrap.appendChild(col);

            var pairs = data.wordcloud || [];
            ns.registerChart(host, function (el, instance) {
                if (!pairs.length) {
                    instance.setOption({
                        title: {
                            text: P.t('No data available'),
                            left: 'center', top: 'middle',
                            textStyle: { fontSize: 13, fontWeight: 'normal' }
                        }
                    });
                    return;
                }
                var opts = (ns.chartOptions && ns.chartOptions.wordcloud)
                    ? ns.chartOptions.wordcloud(pairs)
                    : null;
                if (opts) instance.setOption(opts, true);
            });
        });

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Newspapers breakdown (country-scope sides only)                   */
    /* ----------------------------------------------------------------- */

    function buildNewspapersBreakdown(dataA, dataB) {
        var showA = dataA.scope === 'country' && (dataA.newspapers || []).length;
        var showB = dataB.scope === 'country' && (dataB.newspapers || []).length;
        if (!showA && !showB) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Newspapers within each corpus')));
        var wrap = P.el('div', 'iwac-vis-compare-wordclouds');
        panel.appendChild(wrap);

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var colorA = tokens.primary || '#d86a11';
        var colorB = '#1d4e6b';

        function addSide(side, data, color) {
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', data.name));
            var host = P.el('div', 'iwac-vis-compare-wordcloud__chart');
            col.appendChild(host);
            wrap.appendChild(col);

            var entries = (data.newspapers || []).slice(0, 10).reverse();
            if (!entries.length) {
                host.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                return;
            }
            ns.registerChart(host, function (el, instance) {
                instance.setOption({
                    grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
                    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                    xAxis: { type: 'value' },
                    yAxis: {
                        type: 'category',
                        data: entries.map(function (e) { return e.name; }),
                        axisTick: { show: false },
                        axisLabel: { width: 160, overflow: 'truncate' }
                    },
                    series: [{
                        type: 'bar',
                        itemStyle: { color: color, borderRadius: [0, 4, 4, 0] },
                        label: { show: true, position: 'right',
                                 formatter: function (p) { return P.formatNumber(p.value); } },
                        data: entries.map(function (e) { return e.count; })
                    }],
                    animationDuration: 600,
                    animationEasing: 'cubicOut'
                });
            });
        }

        if (showA) addSide('A', dataA, colorA);
        else {
            // Keep the grid symmetric — blank placeholder column.
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = 'A';
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', dataA.name));
            col.appendChild(P.el('div', 'iwac-vis-empty',
                P.t('Single-newspaper corpus — no breakdown')));
            wrap.appendChild(col);
        }
        if (showB) addSide('B', dataB, colorB);
        else {
            var col2 = P.el('div', 'iwac-vis-compare-wordcloud');
            col2.dataset.side = 'B';
            col2.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', dataB.name));
            col2.appendChild(P.el('div', 'iwac-vis-empty',
                P.t('Single-newspaper corpus — no breakdown')));
            wrap.appendChild(col2);
        }

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Orchestrator                                                      */
    /* ----------------------------------------------------------------- */

    function disposeCharts(root) {
        // Dispose every live ECharts instance registered under `root`
        // so re-rendering after a picker change doesn't stack handlers
        // and memory.
        if (!ns._charts || !ns._charts.length) return;
        var next = [];
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el && root.contains(entry.el)) {
                if (entry.instance && typeof entry.instance.dispose === 'function') {
                    try { entry.instance.dispose(); } catch (e) {}
                }
                if (entry._resizeObserver && typeof entry._resizeObserver.disconnect === 'function') {
                    try { entry._resizeObserver.disconnect(); } catch (e) {}
                }
            } else {
                next.push(entry);
            }
        }
        ns._charts = next;
    }

    function renderResults(resultsRoot, dataA, dataB) {
        disposeCharts(resultsRoot);
        resultsRoot.innerHTML = '';

        resultsRoot.appendChild(buildMetrics(dataA, dataB));

        var grid = P.el('div', 'iwac-vis-compare-grid');
        resultsRoot.appendChild(grid);

        grid.appendChild(buildTimeline(dataA, dataB));
        grid.appendChild(buildOverlapPanel('Subject overlap',
            dataA.subjects, dataB.subjects, dataA, dataB));
        grid.appendChild(buildOverlapPanel('Spatial coverage overlap',
            dataA.spatial, dataB.spatial, dataA, dataB));
        grid.appendChild(buildTopSubjects(dataA, dataB));
        grid.appendChild(buildWordclouds(dataA, dataB));

        var papers = buildNewspapersBreakdown(dataA, dataB);
        if (papers) grid.appendChild(papers);
    }

    function pickDefaults(index) {
        // Pick sensible starting corpora for each side so the block
        // renders something before the user interacts. Prefer two
        // different countries from the articles subset; fall back to
        // whatever's available.
        var subset = index.subsets && index.subsets.articles;
        var countries = subset && subset.countries || [];
        var defA = { type: 'articles', scope: 'country',
                     slug: countries[0] && countries[0].slug };
        var defB = { type: 'articles', scope: 'country',
                     slug: countries[1] && countries[1].slug || (countries[0] && countries[0].slug) };
        if (!defA.slug) {
            // Fallback if articles has no entries but publications does.
            var pub = index.subsets && index.subsets.publications;
            if (pub && pub.countries && pub.countries.length) {
                defA = { type: 'publications', scope: 'country', slug: pub.countries[0].slug };
                defB = { type: 'publications', scope: 'country',
                         slug: pub.countries[Math.min(1, pub.countries.length - 1)].slug };
            }
        }
        return { A: defA, B: defB };
    }

    function initBlock(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };

        fetchJson(indexUrl(ctx.basePath))
            .then(function (index) {
                container.innerHTML = '';

                var root = P.el('div', 'iwac-vis-compare-root');
                container.appendChild(root);

                var pickersEl = P.el('div', 'iwac-vis-compare-pickers');
                root.appendChild(pickersEl);

                var resultsRoot = P.el('div', 'iwac-vis-compare-results');
                root.appendChild(resultsRoot);

                var defaults = pickDefaults(index);
                var state = {
                    A: null, B: null, loading: {}
                };
                var pickers = {};

                function onPickerChange(side) {
                    return function (pickerState) {
                        state.loading[side] = pickerState;
                        var url = corpusUrl(ctx.basePath,
                            pickerState.type, pickerState.scope, pickerState.slug);
                        fetchJson(url).then(function (data) {
                            state[side] = data;
                            if (state.A && state.B) {
                                renderResults(resultsRoot, state.A, state.B);
                            } else {
                                resultsRoot.innerHTML = '';
                                resultsRoot.appendChild(P.el('div', 'iwac-vis-compare-empty',
                                    P.t('Choose two corpora to compare')));
                            }
                        }).catch(function (err) {
                            console.error('IWACVis compare-newspapers:', err);
                            resultsRoot.innerHTML = '';
                            resultsRoot.appendChild(P.el('div', 'iwac-vis-error',
                                P.t('Failed to load')));
                        });
                    };
                }

                SIDES.forEach(function (side) {
                    var picker = buildPicker(side, index, defaults[side], onPickerChange(side));
                    pickers[side] = picker;
                    pickersEl.appendChild(picker.root);
                });

                // Trigger initial loads on both sides.
                SIDES.forEach(function (side) {
                    onPickerChange(side)(pickers[side].getState());
                });
            })
            .catch(function (err) {
                console.error('IWACVis compare-newspapers index:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis compare-newspapers: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-compare-newspapers');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
