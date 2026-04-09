/**
 * IWAC Visualizations — References Overview block
 *
 * Pure client-side visualization. Fetches the full `references` subset
 * (864 rows as of 2026-04) directly from the Hugging Face
 * datasets-server API, aggregates everything in the browser, and renders
 * five panels:
 *
 *   1. Summary cards row
 *   2. Timeline — stacked bar of references per year, by type
 *   3. Reference types distribution — horizontal bar
 *   4. Top authors — horizontal bar
 *   5. Top subjects — horizontal bar
 *
 * No Python precompute needed. The HF datasets-server `/rows` endpoint
 * is paginated at 100 rows per request; with ~864 rows that's 9 parallel
 * requests, well under HF's anonymous rate limit. Results are cached by
 * the browser's HTTP cache (HF sets reasonable Cache-Control headers).
 *
 * Dependencies (loaded before this file by the PHTML):
 *   - echarts 6 (CDN)
 *   - iwac-i18n.js
 *   - iwac-theme.js
 *   - dashboard-core.js (provides IWACVis.registerChart, IWACVis.t, ...)
 *
 * Expected container:
 *   <div class="iwac-vis-block iwac-vis-references-overview"
 *        data-base-path="/..."
 *        data-site-base="/s/sitename">
 *     <div class="iwac-vis-loading">...</div>
 *   </div>
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns) {
        console.warn('IWACVis namespace not found — did dashboard-core.js load?');
        return;
    }

    /* ----------------------------------------------------------------- */
    /*  Configuration                                                     */
    /* ----------------------------------------------------------------- */

    var DATASET_ID = 'fmadore/islam-west-africa-collection';
    var SUBSET = 'references';
    var SPLIT = 'train';
    var PAGE_SIZE = 100; // HF datasets-server cap
    var API_BASE = 'https://datasets-server.huggingface.co/rows';

    var TOP_N_AUTHORS = 15;
    var TOP_N_SUBJECTS = 15;
    var TOP_N_TYPES    = 10;

    /* ----------------------------------------------------------------- */
    /*  DOM helpers                                                       */
    /* ----------------------------------------------------------------- */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function t(key, params) { return ns.t(key, params); }
    function formatNumber(n) { return ns.formatNumber ? ns.formatNumber(n) : String(n); }

    /* ----------------------------------------------------------------- */
    /*  HF datasets-server fetching                                       */
    /* ----------------------------------------------------------------- */

    function buildRowsUrl(offset, length) {
        var params = new URLSearchParams({
            dataset: DATASET_ID,
            config: SUBSET,
            split: SPLIT,
            offset: String(offset),
            length: String(length)
        });
        return API_BASE + '?' + params.toString();
    }

    /**
     * Fetch a single page and return { rows: [...], total: N }.
     * `rows` is an array of the inner row objects (not wrapped).
     */
    function fetchPage(offset, length) {
        return fetch(buildRowsUrl(offset, length), {
            headers: { Accept: 'application/json' }
        }).then(function (r) {
            if (!r.ok) throw new Error('HF rows HTTP ' + r.status);
            return r.json();
        }).then(function (payload) {
            var rows = (payload.rows || []).map(function (entry) { return entry.row || {}; });
            return { rows: rows, total: payload.num_rows_total };
        });
    }

    /**
     * Fetch ALL rows of the subset. Fires the first page, uses its
     * total to plan remaining pages, then fetches the rest in parallel.
     */
    function fetchAllReferences() {
        return fetchPage(0, PAGE_SIZE).then(function (first) {
            var total = first.total;
            if (!total || total <= first.rows.length) {
                return first.rows;
            }
            var pagesNeeded = Math.ceil(total / PAGE_SIZE);
            var promises = [];
            for (var i = 1; i < pagesNeeded; i++) {
                promises.push(fetchPage(i * PAGE_SIZE, PAGE_SIZE));
            }
            return Promise.all(promises).then(function (pages) {
                var all = first.rows.slice();
                pages.forEach(function (p) { all = all.concat(p.rows); });
                return all;
            });
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Field helpers                                                     */
    /* ----------------------------------------------------------------- */

    function parsePipe(value) {
        if (value == null) return [];
        if (Array.isArray(value)) return value.map(function (v) { return String(v).trim(); }).filter(Boolean);
        var str = String(value).trim();
        if (!str) return [];
        return str.split('|').map(function (v) { return v.trim(); }).filter(Boolean);
    }

    function extractYear(value) {
        if (value == null) return null;
        var str = String(value).trim();
        if (!str) return null;
        var match = str.match(/\b(19|20)\d{2}\b/);
        if (!match) return null;
        var year = parseInt(match[0], 10);
        if (year >= 1900 && year <= 2100) return year;
        return null;
    }

    function getRefType(row) {
        var raw = row['o:resource_class'] || row.type || '';
        raw = String(raw).trim();
        return raw || 'Unknown';
    }

    /** Translate a French reference type to the current locale. */
    function translateType(type) {
        var key = 'ref_type_' + type;
        var translated = t(key);
        // ns.t falls back to the key when no entry is found; detect that.
        return translated === key ? type : translated;
    }

    /* ----------------------------------------------------------------- */
    /*  Aggregations                                                      */
    /* ----------------------------------------------------------------- */

    function summarize(rows) {
        var authors = new Set();
        var publishers = new Set();
        var languages = new Set();
        var countries = new Set();
        var types = new Set();
        var yearMin = null, yearMax = null;

        rows.forEach(function (row) {
            parsePipe(row.author).forEach(function (a) { if (a) authors.add(a); });
            parsePipe(row.publisher).forEach(function (p) { if (p) publishers.add(p); });
            parsePipe(row.language).forEach(function (l) { if (l) languages.add(l); });
            parsePipe(row.country).forEach(function (c) { if (c) countries.add(c); });
            types.add(getRefType(row));
            var year = extractYear(row.pub_date);
            if (year != null) {
                if (yearMin == null || year < yearMin) yearMin = year;
                if (yearMax == null || year > yearMax) yearMax = year;
            }
        });

        return {
            total: rows.length,
            authors: authors.size,
            publishers: publishers.size,
            languages: languages.size,
            countries: countries.size,
            types: types.size,
            year_min: yearMin,
            year_max: yearMax
        };
    }

    function timelineByType(rows) {
        var byYearType = {}; // year -> type -> count
        var typeTotals = {};
        var seenYears = new Set();

        rows.forEach(function (row) {
            var year = extractYear(row.pub_date);
            if (year == null) return;
            var type = getRefType(row);
            seenYears.add(year);
            if (!byYearType[year]) byYearType[year] = {};
            byYearType[year][type] = (byYearType[year][type] || 0) + 1;
            typeTotals[type] = (typeTotals[type] || 0) + 1;
        });

        var years = Array.from(seenYears).sort(function (a, b) { return a - b; });
        // Order types by total desc so the biggest stacks sit at the bottom
        var types = Object.keys(typeTotals).sort(function (a, b) {
            return typeTotals[b] - typeTotals[a];
        });

        var series = {};
        types.forEach(function (type) {
            series[type] = years.map(function (y) {
                return (byYearType[y] && byYearType[y][type]) || 0;
            });
        });

        return { years: years, types: types, series: series };
    }

    function countByPipe(rows, field) {
        var counter = {};
        rows.forEach(function (row) {
            parsePipe(row[field]).forEach(function (v) {
                if (!v) return;
                counter[v] = (counter[v] || 0) + 1;
            });
        });
        return counter;
    }

    function topN(counter, n) {
        return Object.keys(counter)
            .map(function (k) { return { name: k, count: counter[k] }; })
            .sort(function (a, b) { return b.count - a.count; })
            .slice(0, n);
    }

    function typeDistribution(rows, n) {
        var counter = {};
        rows.forEach(function (row) {
            var type = getRefType(row);
            counter[type] = (counter[type] || 0) + 1;
        });
        return topN(counter, n);
    }

    /* ----------------------------------------------------------------- */
    /*  Layout                                                            */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, summary) {
        container.innerHTML = '';
        var root = el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        // Summary cards
        var cards = [
            { key: 'References', value: summary.total },
            { key: 'Authors',    value: summary.authors },
            { key: 'Publishers', value: summary.publishers },
            { key: 'Reference types', value: summary.types },
            { key: 'Languages',  value: summary.languages },
            { key: 'Countries',  value: summary.countries }
        ];
        var cardsEl = el('div', 'iwac-vis-overview-summary');
        cards.forEach(function (c) {
            if (c.value == null) return;
            var card = el('div', 'iwac-vis-summary-card');
            card.appendChild(el('div', 'iwac-vis-summary-card__value', formatNumber(c.value)));
            card.appendChild(el('div', 'iwac-vis-summary-card__label', t(c.key)));
            cardsEl.appendChild(card);
        });
        root.appendChild(cardsEl);

        if (summary.year_min && summary.year_max) {
            var range = el('p', 'iwac-vis-overview-subtitle');
            range.textContent =
                t('Across') + ' ' + t('year_range', { min: summary.year_min, max: summary.year_max });
            root.appendChild(range);
        }

        var grid = el('div', 'iwac-vis-overview-grid');
        root.appendChild(grid);

        // Timeline — full width
        var timelinePanel = buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            t('References by type over time')
        );
        grid.appendChild(timelinePanel.panel);

        // Reference types
        var typesPanel = buildPanel('iwac-vis-panel', t('Reference types'));
        grid.appendChild(typesPanel.panel);

        // Languages
        var languagesPanel = buildPanel('iwac-vis-panel', t('Languages studied'));
        grid.appendChild(languagesPanel.panel);

        // Top authors — full width
        var authorsPanel = buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            t('Top authors')
        );
        grid.appendChild(authorsPanel.panel);

        // Top subjects — full width
        var subjectsPanel = buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            t('Top subjects')
        );
        grid.appendChild(subjectsPanel.panel);

        return {
            timeline:  timelinePanel.chart,
            types:     typesPanel.chart,
            languages: languagesPanel.chart,
            authors:   authorsPanel.chart,
            subjects:  subjectsPanel.chart
        };
    }

    function buildPanel(className, titleText) {
        var panel = el('div', className);
        panel.appendChild(el('h4', null, titleText));
        var chart = el('div', 'iwac-vis-chart');
        panel.appendChild(chart);
        return { panel: panel, chart: chart };
    }

    /* ----------------------------------------------------------------- */
    /*  Chart option builders                                             */
    /* ----------------------------------------------------------------- */

    function buildTimelineOption(timeline) {
        var years = timeline.years;
        var series = timeline.types.map(function (type) {
            return {
                name: translateType(type),
                type: 'bar',
                stack: 'total',
                barMaxWidth: 28,
                emphasis: { focus: 'series' },
                data: timeline.series[type]
            };
        });

        var useZoom = years.length > 20;
        return {
            grid: { left: 48, right: 16, top: 48, bottom: useZoom ? 56 : 32 },
            legend: {
                type: 'scroll',
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: {
                type: 'category',
                data: years,
                name: t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: {
                type: 'value',
                name: t('Count')
            },
            dataZoom: useZoom
                ? [
                      { type: 'slider', start: 40, end: 100, bottom: 8, height: 18 },
                      { type: 'inside' }
                  ]
                : [],
            series: series
        };
    }

    function buildHorizontalBarOption(entries) {
        var names = entries.map(function (e) { return e.name; });
        var values = entries.map(function (e) { return e.count; });
        return {
            grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barMaxWidth: 20,
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (p) { return formatNumber(p.value); }
                    }
                }
            ]
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initReferencesOverview(container) {
        // Replace the static loading text with one that says "fetching references"
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = t('Fetching references…');

        fetchAllReferences()
            .then(function (rows) {
                if (!rows || rows.length === 0) {
                    container.innerHTML = '';
                    container.appendChild(el('div', 'iwac-vis-empty', t('No data available')));
                    return;
                }

                var summary = summarize(rows);
                var handles = buildLayout(container, summary);

                // 1. Timeline
                var timeline = timelineByType(rows);
                if (timeline.years.length > 0) {
                    ns.registerChart(handles.timeline, function (el, chart) {
                        chart.setOption(buildTimelineOption(timeline));
                    });
                }

                // 2. Reference types distribution — translate the labels
                var types = typeDistribution(rows, TOP_N_TYPES).map(function (e) {
                    return { name: translateType(e.name), count: e.count };
                });
                if (types.length > 0) {
                    ns.registerChart(handles.types, function (el, chart) {
                        chart.setOption(buildHorizontalBarOption(types));
                    });
                }

                // 3. Languages
                var languages = topN(countByPipe(rows, 'language'), 10);
                if (languages.length > 0) {
                    ns.registerChart(handles.languages, function (el, chart) {
                        chart.setOption(buildHorizontalBarOption(languages));
                    });
                }

                // 4. Top authors
                var authors = topN(countByPipe(rows, 'author'), TOP_N_AUTHORS);
                if (authors.length > 0) {
                    ns.registerChart(handles.authors, function (el, chart) {
                        chart.setOption(buildHorizontalBarOption(authors));
                    });
                }

                // 5. Top subjects
                var subjects = topN(countByPipe(rows, 'subject'), TOP_N_SUBJECTS);
                if (subjects.length > 0) {
                    ns.registerChart(handles.subjects, function (el, chart) {
                        chart.setOption(buildHorizontalBarOption(subjects));
                    });
                }
            })
            .catch(function (err) {
                console.error('IWACVis references overview:', err);
                container.innerHTML = '';
                var errEl = el('div', 'iwac-vis-error', t('Failed to load'));
                container.appendChild(errEl);
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis references overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-references-overview');
        for (var i = 0; i < containers.length; i++) {
            initReferencesOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
