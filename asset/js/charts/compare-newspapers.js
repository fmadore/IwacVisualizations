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
 *   3. Subject overlap — clickable tags (shared / only-A / only-B)
 *   4. Spatial overlap — clickable tags
 *   5. Geographic map — MapLibre bubbles for each side
 *   6. Top subjects bar chart (side by side)
 *   7. Wordclouds — side by side
 *   8. Sentiment comparison (articles only, three-model picker)
 *   9. Newspapers breakdown (country-scope sides only)
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

    // One counter per block instance isn't worth the plumbing — a module-
    // level counter guarantees each select on the page gets a unique id,
    // even if two compare-newspapers blocks render side by side.
    var _uid = 0;

    function buildPicker(side, index, defaults, onChange) {
        var state = {
            type: defaults.type,
            scope: defaults.scope,
            slug: defaults.slug
        };
        var suffix = side + '-' + (++_uid);

        var card = P.el('div', 'iwac-vis-compare-picker');
        card.dataset.side = side;

        var eyebrow = P.el('div', 'iwac-vis-compare-picker__eyebrow',
            P.t(side === 'A' ? 'Corpus A' : 'Corpus B'));
        card.appendChild(eyebrow);

        // --- Type switch (articles / publications) -------------------
        var typeRow = P.el('div', 'iwac-vis-compare-picker__row');
        var typeLabel = P.el('span', 'iwac-vis-compare-picker__label', P.t('Type'));
        typeLabel.id = 'iwac-cmp-type-label-' + suffix;
        typeRow.appendChild(typeLabel);
        var typeBar = P.el('div', 'iwac-vis-compare-picker__type');
        typeBar.setAttribute('role', 'radiogroup');
        typeBar.setAttribute('aria-labelledby', typeLabel.id);
        var typeButtons = {};
        ['articles', 'publications'].forEach(function (key) {
            var btn = P.el('button', null,
                P.t(key === 'articles' ? 'Newspaper articles' : 'Islamic publications'));
            btn.type = 'button';
            btn.name = 'iwac-cmp-type-' + suffix;
            btn.id = 'iwac-cmp-type-' + key + '-' + suffix;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', 'false');
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', function () {
                if (state.type === key) return;
                state.type = key;
                var subset = index.subsets && index.subsets[state.type];
                if (subset) {
                    if (state.scope === 'country' && !(subset.countries || []).length) {
                        state.scope = 'newspaper';
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
        var scopeLabel = P.el('label', 'iwac-vis-compare-picker__label', P.t('Scope'));
        scopeLabel.htmlFor = 'iwac-cmp-scope-' + suffix;
        scopeRow.appendChild(scopeLabel);
        var scopeSelect = P.el('select', 'iwac-vis-compare-picker__select');
        scopeSelect.id = 'iwac-cmp-scope-' + suffix;
        scopeSelect.name = 'iwac-cmp-scope-' + suffix;
        scopeSelect.addEventListener('change', function () {
            state.scope = scopeSelect.value;
            rebuildName();
            fire();
        });
        scopeRow.appendChild(scopeSelect);
        card.appendChild(scopeRow);

        // --- Name dropdown (country / newspaper name) ----------------
        var nameRow = P.el('div', 'iwac-vis-compare-picker__row');
        var nameLabel = P.el('label', 'iwac-vis-compare-picker__label', P.t('Selection'));
        nameLabel.htmlFor = 'iwac-cmp-selection-' + suffix;
        nameRow.appendChild(nameLabel);
        var nameSelect = P.el('select', 'iwac-vis-compare-picker__select');
        nameSelect.id = 'iwac-cmp-selection-' + suffix;
        nameSelect.name = 'iwac-cmp-selection-' + suffix;
        nameSelect.addEventListener('change', function () {
            state.slug = nameSelect.value;
            fire();
        });
        nameRow.appendChild(nameSelect);
        card.appendChild(nameRow);

        function refreshButtons() {
            Object.keys(typeButtons).forEach(function (k) {
                var isActive = k === state.type;
                typeButtons[k].setAttribute('aria-pressed', isActive ? 'true' : 'false');
                typeButtons[k].setAttribute('aria-checked', isActive ? 'true' : 'false');
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
            // Country dropdowns stay sorted by count (5–6 entries, intuitive).
            // Newspaper dropdowns are re-sorted alphabetically — the
            // generator emits them count-desc for threshold purposes, but
            // users scan a long list faster when it's A → Z.
            if (state.scope === 'newspaper') {
                list = list.slice().sort(function (a, b) {
                    return a.name.localeCompare(b.name, ns.locale || 'fr', { sensitivity: 'base' });
                });
            }
            list.forEach(function (entry) {
                var label = entry.name + ' (' + P.formatNumber(entry.count) + ')';
                if (entry.country && state.scope === 'newspaper') {
                    label = entry.name + ' \u2014 ' + entry.country
                        + ' (' + P.formatNumber(entry.count) + ')';
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
            { labelKey: 'Total items',      pick: function (d) { return d.summary.total_items; }, numeric: true },
            { labelKey: 'Total words',      pick: function (d) { return d.summary.total_words; }, numeric: true },
            { labelKey: 'Period covered',   pick: function (d) {
                if (d.summary.year_min && d.summary.year_max) {
                    return d.summary.year_min + '\u2013' + d.summary.year_max;
                }
                return '\u2014';
            }, numeric: false },
            { labelKey: 'Unique subjects',  pick: function (d) { return d.summary.unique_subjects; }, numeric: true },
            { labelKey: 'Places mentioned', pick: function (d) { return d.summary.unique_spatial; }, numeric: true },
            { labelKey: 'Newspapers',       pick: function (d) { return d.summary.unique_newspapers; }, numeric: true },
            { labelKey: 'Languages',        pick: function (d) { return d.summary.unique_languages; }, numeric: true },
            { labelKey: 'Total pages',      pick: function (d) { return d.summary.total_pages; }, numeric: true, skipIfZero: true }
        ];

        metrics.forEach(function (m) {
            var vA = m.pick(dataA);
            var vB = m.pick(dataB);
            if (m.skipIfZero && !vA && !vB) return;

            var card = P.el('div', 'iwac-vis-compare-metric');
            card.appendChild(P.el('div', 'iwac-vis-compare-metric__label', P.t(m.labelKey)));
            var pair = P.el('div', 'iwac-vis-compare-metric__pair');
            var valueCls = 'iwac-vis-compare-metric__value' + (m.numeric ? '' : ' iwac-vis-compare-metric__value--text');
            var a = P.el('div', valueCls,
                m.numeric ? P.formatNumber(vA || 0) : String(vA));
            a.dataset.side = 'A';
            a.title = dataA.name;
            var b = P.el('div', valueCls,
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
    /*  Overlap columns (shared / only-A / only-B) — clickable tags       */
    /* ----------------------------------------------------------------- */

    function computeOverlap(listA, listB, topN) {
        var mapA = {};
        var mapB = {};
        (listA || []).forEach(function (e) { mapA[e.name] = e; });
        (listB || []).forEach(function (e) { mapB[e.name] = e; });

        var shared = [];
        var onlyA = [];
        var onlyB = [];

        Object.keys(mapA).forEach(function (name) {
            if (Object.prototype.hasOwnProperty.call(mapB, name)) {
                shared.push({
                    name: name,
                    countA: mapA[name].count,
                    countB: mapB[name].count,
                    combined: mapA[name].count + mapB[name].count,
                    o_id: mapA[name].o_id || mapB[name].o_id
                });
            } else {
                onlyA.push({ name: name, count: mapA[name].count, o_id: mapA[name].o_id });
            }
        });
        Object.keys(mapB).forEach(function (name) {
            if (!Object.prototype.hasOwnProperty.call(mapA, name)) {
                onlyB.push({ name: name, count: mapB[name].count, o_id: mapB[name].o_id });
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

    function buildOverlapList(items, kind, ctx) {
        var ul = P.el('ul', 'iwac-vis-compare-overlap__list');
        items.forEach(function (item) {
            // Wrap each tag in an <a> when the o:id resolved — that points
            // to the authority-record page for the entity (Lieu / Sujet /
            // Personne / etc.), matching what the rest of the theme does
            // for index links.
            var tag;
            if (item.o_id && ctx && ctx.siteBase) {
                tag = P.el('a', 'iwac-vis-compare-overlap__tag');
                tag.href = ctx.siteBase + '/item/' + item.o_id;
            } else {
                tag = P.el('li', 'iwac-vis-compare-overlap__tag');
            }
            tag.appendChild(P.el('strong', null, item.name));
            if (kind === 'shared') {
                tag.appendChild(P.el('span', null, ' \u00b7 '
                    + P.formatNumber(item.countA) + ' / ' + P.formatNumber(item.countB)));
            } else {
                tag.appendChild(P.el('span', null, ' \u00b7 ' + P.formatNumber(item.count)));
            }
            if (tag.tagName.toLowerCase() === 'a') {
                var li = P.el('li');
                li.style.listStyle = 'none';
                li.style.margin = '0';
                li.appendChild(tag);
                ul.appendChild(li);
            } else {
                ul.appendChild(tag);
            }
        });
        return ul;
    }

    function buildOverlapPanel(titleKey, listA, listB, dataA, dataB, ctx) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t(titleKey)));
        var grid = P.el('div', 'iwac-vis-compare-overlap');
        panel.appendChild(grid);

        var overlap = computeOverlap(listA, listB, DEFAULT_TOP_OVERLAP);

        function makeCol(kind, titleText, total, items) {
            var col = P.el('div', 'iwac-vis-compare-overlap__col');
            col.dataset.kind = kind;
            var title = P.el('div', 'iwac-vis-compare-overlap__title', titleText);
            title.appendChild(P.el('span', 'iwac-vis-compare-overlap__count',
                ' \u00b7 ' + P.formatNumber(total)));
            col.appendChild(title);
            if (items.length === 0) {
                col.appendChild(P.el('div', 'iwac-vis-compare-overlap__empty', P.t('No overlap')));
            } else {
                col.appendChild(buildOverlapList(items, kind, ctx));
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
        var top = allNames.slice(0, 15).reverse();

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
                if (opts) {
                    instance.setOption(opts, true);
                } else {
                    // chart-options wasn't loaded — fall back to a plain
                    // horizontal bar chart so the panel stays useful.
                    var top = pairs.slice(0, 20);
                    instance.setOption({
                        grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
                        xAxis: { type: 'value' },
                        yAxis: {
                            type: 'category',
                            inverse: true,
                            data: top.map(function (p) { return p[0]; }),
                            axisLabel: { width: 120, overflow: 'truncate' }
                        },
                        series: [{
                            type: 'bar',
                            data: top.map(function (p) { return p[1]; })
                        }]
                    }, true);
                }
            });
        });

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  MapLibre spatial-comparison panel                                 */
    /* ----------------------------------------------------------------- */

    function buildMap(dataA, dataB, ctx) {
        var aPts = dataA.geo_points || [];
        var bPts = dataB.geo_points || [];
        if (!aPts.length && !bPts.length) return null;
        if (typeof maplibregl === 'undefined' || !P.createIwacMap) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Geographic comparison')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.')));

        var mapHost = P.el('div', 'iwac-vis-compare-map iwac-vis-map');
        panel.appendChild(mapHost);

        // Legend
        var legend = P.el('div', 'iwac-vis-compare-map-legend');
        function legendSwatch(cls, label) {
            var wrap = P.el('span', 'iwac-vis-compare-map-legend__swatch');
            wrap.appendChild(P.el('span', 'iwac-vis-compare-map-legend__dot ' + cls));
            wrap.appendChild(document.createTextNode(' ' + label));
            return wrap;
        }
        legend.appendChild(legendSwatch('iwac-vis-compare-map-legend__dot--a', dataA.name));
        legend.appendChild(legendSwatch('iwac-vis-compare-map-legend__dot--b', dataB.name));
        panel.appendChild(legend);

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var colorA = tokens.primary || '#d86a11';
        var colorB = '#1d4e6b';

        function toGeoJSON(pts) {
            return {
                type: 'FeatureCollection',
                features: pts.map(function (p) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                        properties: {
                            name: p.name,
                            count: p.count,
                            o_id: p.o_id || null
                        }
                    };
                })
            };
        }
        var geoA = toGeoJSON(aPts);
        var geoB = toGeoJSON(bPts);

        // Compute the max count across both sides for a shared radius scale.
        var maxCount = 1;
        aPts.concat(bPts).forEach(function (p) {
            if (p.count > maxCount) maxCount = p.count;
        });
        var MAX_RADIUS = 30;
        function circleRadiusExpr() {
            return [
                'interpolate', ['linear'],
                ['get', 'count'],
                0, 3,
                maxCount, MAX_RADIUS
            ];
        }

        // Build a rough bounds box covering both sides so the initial
        // fitBounds lands on West Africa without hardcoding a region.
        function bounds(pts) {
            if (!pts.length) return null;
            var minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
            pts.forEach(function (p) {
                if (p.lng < minLng) minLng = p.lng;
                if (p.lng > maxLng) maxLng = p.lng;
                if (p.lat < minLat) minLat = p.lat;
                if (p.lat > maxLat) maxLat = p.lat;
            });
            return [[minLng, minLat], [maxLng, maxLat]];
        }

        var map = P.createIwacMap(mapHost, {
            center: [1, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                // Side A
                m.addSource('compare-a', { type: 'geojson', data: geoA });
                m.addLayer({
                    id: 'compare-a-circles', type: 'circle', source: 'compare-a',
                    paint: {
                        'circle-radius': circleRadiusExpr(),
                        'circle-color': colorA,
                        'circle-opacity': 0.45,
                        'circle-stroke-color': colorA,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-opacity': 0.9
                    }
                });

                // Side B
                m.addSource('compare-b', { type: 'geojson', data: geoB });
                m.addLayer({
                    id: 'compare-b-circles', type: 'circle', source: 'compare-b',
                    paint: {
                        'circle-radius': circleRadiusExpr(),
                        'circle-color': colorB,
                        'circle-opacity': 0.45,
                        'circle-stroke-color': colorB,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-opacity': 0.9
                    }
                });

                ['compare-a-circles', 'compare-b-circles'].forEach(function (layerId) {
                    m.on('click', layerId, function (e) {
                        var f = e.features && e.features[0];
                        if (!f) return;
                        var name = f.properties.name || '';
                        var count = f.properties.count || 0;
                        var oid = f.properties.o_id;
                        var html = '<strong>' + P.escapeHtml(name) + '</strong><br>'
                            + P.formatNumber(count) + ' ' + P.t('mentions');
                        if (oid && ctx && ctx.siteBase) {
                            html += '<br><a href="' + ctx.siteBase + '/item/' + oid + '">'
                                + P.t('Open entity') + '</a>';
                        }
                        (P.createIwacPopup ? P.createIwacPopup() : new maplibregl.Popup())
                            .setLngLat(e.lngLat)
                            .setHTML(html)
                            .addTo(m);
                    });
                    m.on('mouseenter', layerId, function () {
                        m.getCanvas().style.cursor = 'pointer';
                    });
                    m.on('mouseleave', layerId, function () {
                        m.getCanvas().style.cursor = '';
                    });
                });

                var allPts = aPts.concat(bPts);
                var b = bounds(allPts);
                if (b) {
                    try {
                        m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 6 });
                    } catch (e) { /* empty or invalid bounds — keep default view */ }
                }
            }
        });

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Sentiment comparison (articles only)                              */
    /* ----------------------------------------------------------------- */

    var SENTIMENT_MODELS = [
        { key: 'gemini',  label: 'Gemini' },
        { key: 'chatgpt', label: 'ChatGPT' },
        { key: 'mistral', label: 'Mistral' }
    ];

    function buildSentiment(dataA, dataB) {
        var hasA = dataA.type === 'articles' && dataA.sentiment && dataA.sentiment.models;
        var hasB = dataB.type === 'articles' && dataB.sentiment && dataB.sentiment.models;
        if (!hasA && !hasB) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('AI sentiment comparison')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('Distribution of polarity and centrality in articles of each corpus, as rated by three AI models. The picker swaps the model; publications are not rated.')));

        // Toolbar — axis + model picker
        var toolbar = P.el('div', 'iwac-vis-compare-sentiment__toolbar');
        var axisLabel = P.el('label', null, P.t('Axis'));
        axisLabel.htmlFor = 'iwac-cmp-sent-axis-' + (++_uid);
        var axisSelect = P.el('select');
        axisSelect.id = axisLabel.htmlFor;
        [
            { key: 'polarite',   label: P.t('Polarity') },
            { key: 'centralite', label: P.t('Centrality') }
        ].forEach(function (o) {
            var opt = P.el('option', null, o.label);
            opt.value = o.key;
            axisSelect.appendChild(opt);
        });

        var modelLabel = P.el('label', null, P.t('Model'));
        modelLabel.htmlFor = 'iwac-cmp-sent-model-' + (++_uid);
        var modelSelect = P.el('select');
        modelSelect.id = modelLabel.htmlFor;
        SENTIMENT_MODELS.forEach(function (m) {
            var opt = P.el('option', null, m.label);
            opt.value = m.key;
            modelSelect.appendChild(opt);
        });

        toolbar.appendChild(axisLabel);
        toolbar.appendChild(axisSelect);
        toolbar.appendChild(modelLabel);
        toolbar.appendChild(modelSelect);
        panel.appendChild(toolbar);

        var wrap = P.el('div', 'iwac-vis-compare-sentiment');
        panel.appendChild(wrap);

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var colorA = tokens.primary || '#d86a11';
        var colorB = '#1d4e6b';

        function makeSide(side, data, color) {
            var col = P.el('div', 'iwac-vis-compare-sentiment__col');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-sentiment__heading', data.name));
            var host = P.el('div', 'iwac-vis-compare-sentiment__chart');
            col.appendChild(host);
            wrap.appendChild(col);

            var chart = ns.registerChart(host, function (el, instance) {
                renderSentiment(instance, data, color);
            });
            return { host: host, chart: chart, data: data, color: color };
        }

        function renderSentiment(instance, data, color) {
            if (!instance || instance.isDisposed()) return;
            var axis = axisSelect.value;     // polarite | centralite
            var model = modelSelect.value;   // gemini | chatgpt | mistral
            var entries = (((data.sentiment || {}).models || {})[model] || {})[axis] || [];
            if (!entries.length) {
                instance.setOption({
                    title: {
                        text: P.t('Not rated'),
                        left: 'center', top: 'middle',
                        textStyle: { fontSize: 13, fontWeight: 'normal' }
                    }
                }, true);
                return;
            }

            instance.setOption({
                grid: { left: 8, right: 40, top: 24, bottom: 8, containLabel: true },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                xAxis: { type: 'value' },
                yAxis: {
                    type: 'category',
                    inverse: true,
                    data: entries.map(function (e) { return P.t(e.label) || e.label; }),
                    axisTick: { show: false },
                    axisLabel: { width: 140, overflow: 'truncate' }
                },
                series: [{
                    type: 'bar',
                    itemStyle: { color: color, borderRadius: [0, 4, 4, 0] },
                    label: { show: true, position: 'right',
                             formatter: function (p) { return P.formatNumber(p.value); } },
                    data: entries.map(function (e) { return e.count; })
                }],
                animationDuration: 500,
                animationEasing: 'cubicOut'
            }, true);
        }

        var sides = [];
        if (hasA) sides.push(makeSide('A', dataA, colorA));
        else {
            var placeA = P.el('div', 'iwac-vis-compare-sentiment__col');
            placeA.dataset.side = 'A';
            placeA.appendChild(P.el('div', 'iwac-vis-compare-sentiment__heading', dataA.name));
            placeA.appendChild(P.el('div', 'iwac-vis-empty', P.t('Sentiment only on articles')));
            wrap.appendChild(placeA);
        }
        if (hasB) sides.push(makeSide('B', dataB, colorB));
        else {
            var placeB = P.el('div', 'iwac-vis-compare-sentiment__col');
            placeB.dataset.side = 'B';
            placeB.appendChild(P.el('div', 'iwac-vis-compare-sentiment__heading', dataB.name));
            placeB.appendChild(P.el('div', 'iwac-vis-empty', P.t('Sentiment only on articles')));
            wrap.appendChild(placeB);
        }

        function rerenderAll() {
            sides.forEach(function (s) {
                var live = ns.getLiveChart ? ns.getLiveChart(s.host) : s.chart;
                if (live) renderSentiment(live, s.data, s.color);
            });
        }
        axisSelect.addEventListener('change', rerenderAll);
        modelSelect.addEventListener('change', rerenderAll);

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

        function placeholderCol(side, name) {
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', name));
            col.appendChild(P.el('div', 'iwac-vis-empty',
                P.t('Single-newspaper corpus \u2014 no breakdown')));
            wrap.appendChild(col);
        }

        if (showA) addSide('A', dataA, colorA); else placeholderCol('A', dataA.name);
        if (showB) addSide('B', dataB, colorB); else placeholderCol('B', dataB.name);

        return panel;
    }


    /* ----------------------------------------------------------------- */
    /*  Orchestrator                                                      */
    /* ----------------------------------------------------------------- */

    function disposeCharts(root) {
        if (!ns._charts || !ns._charts.length) return;
        var next = [];
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el && root.contains(entry.el)) {
                if (entry.instance && typeof entry.instance.dispose === 'function') {
                    try { entry.instance.dispose(); } catch (e) {}
                }
                if (entry.kind === 'maplibre' && entry.instance && typeof entry.instance.remove === 'function') {
                    try { entry.instance.remove(); } catch (e) {}
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

    function renderResults(resultsRoot, dataA, dataB, ctx) {
        disposeCharts(resultsRoot);
        resultsRoot.innerHTML = '';

        resultsRoot.appendChild(buildMetrics(dataA, dataB));

        var grid = P.el('div', 'iwac-vis-compare-grid');
        resultsRoot.appendChild(grid);

        grid.appendChild(buildTimeline(dataA, dataB));
        grid.appendChild(buildOverlapPanel('Subject overlap',
            dataA.subjects, dataB.subjects, dataA, dataB, ctx));
        grid.appendChild(buildOverlapPanel('Spatial coverage overlap',
            dataA.spatial, dataB.spatial, dataA, dataB, ctx));

        var mapPanel = buildMap(dataA, dataB, ctx);
        if (mapPanel) grid.appendChild(mapPanel);

        grid.appendChild(buildTopSubjects(dataA, dataB));
        grid.appendChild(buildWordclouds(dataA, dataB));

        var sentimentPanel = buildSentiment(dataA, dataB);
        if (sentimentPanel) grid.appendChild(sentimentPanel);

        var papers = buildNewspapersBreakdown(dataA, dataB);
        if (papers) grid.appendChild(papers);
    }

    function pickDefaults(index) {
        var subset = index.subsets && index.subsets.articles;
        var countries = (subset && subset.countries) || [];
        var defA = { type: 'articles', scope: 'country',
                     slug: countries[0] && countries[0].slug };
        var defB = { type: 'articles', scope: 'country',
                     slug: countries[1] && countries[1].slug || (countries[0] && countries[0].slug) };
        if (!defA.slug) {
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
                var state = { A: null, B: null };
                var pickers = {};

                function onPickerChange(side) {
                    return function (pickerState) {
                        var url = corpusUrl(ctx.basePath,
                            pickerState.type, pickerState.scope, pickerState.slug);
                        fetchJson(url).then(function (data) {
                            state[side] = data;
                            if (state.A && state.B) {
                                renderResults(resultsRoot, state.A, state.B, ctx);
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
