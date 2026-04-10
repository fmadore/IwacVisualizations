/**
 * IWAC Visualizations — References Overview block (controller)
 *
 * Pure client-side. Paginates the Hugging Face datasets-server `/rows`
 * endpoint (~9 parallel requests for 864 rows), aggregates in the
 * browser, and renders using IWACVis.panels + IWACVis.chartOptions.
 *
 * Panels (in render order):
 *   1. Summary cards row
 *   2. "Period covered" subtitle
 *   3. Timeline — stacked bar of references per year, by type (wide)
 *   4. Reference types — horizontal bar
 *   5. Languages represented — pie
 *   6. Countries studied — horizontal bar
 *   7. Top authors — horizontal bar (wide)
 *   8. Top subjects — horizontal bar (wide)
 *   9. References breakdown — treemap country → type (wide)
 *
 * Load order: after shared/panels.js + shared/chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis references overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /* ----------------------------------------------------------------- */
    /*  HF API configuration                                              */
    /* ----------------------------------------------------------------- */

    var DATASET_ID = 'fmadore/islam-west-africa-collection';
    var SUBSET = 'references';
    var SPLIT = 'train';
    var PAGE_SIZE = 100;
    var API_BASE = 'https://datasets-server.huggingface.co/rows';

    var TOP_N_AUTHORS  = 15;
    var TOP_N_SUBJECTS = 15;
    var TOP_N_TYPES    = 10;

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

    function fetchAllReferences() {
        return fetchPage(0, PAGE_SIZE).then(function (first) {
            var total = first.total;
            if (!total || total <= first.rows.length) return first.rows;
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
    /*  Field helpers + reference-type translation                        */
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

    function translateType(type) {
        var key = 'ref_type_' + type;
        var translated = P.t(key);
        return translated === key ? type : translated;
    }

    /* ----------------------------------------------------------------- */
    /*  Client-side aggregations                                          */
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
            parsePipe(row.country).forEach(function (c) { if (c && !P.isUnknown(c)) countries.add(c); });
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

    /** Build a timeline object shaped like the generator's output. */
    function timelineByType(rows) {
        var byYearType = {};
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
        var types = Object.keys(typeTotals).sort(function (a, b) {
            return typeTotals[b] - typeTotals[a];
        });

        var series = {};
        types.forEach(function (type) {
            series[type] = years.map(function (y) {
                return (byYearType[y] && byYearType[y][type]) || 0;
            });
        });

        // `countries` key is just the stack-series categories — repurposing
        // the same field name so C.timeline can consume this shape directly.
        return {
            years: years,
            countries: types.map(translateType),
            series: (function () {
                var translated = {};
                types.forEach(function (type) { translated[translateType(type)] = series[type]; });
                return translated;
            })()
        };
    }

    function countByPipe(rows, field) {
        var counter = {};
        rows.forEach(function (row) {
            parsePipe(row[field]).forEach(function (v) {
                if (!v || P.isUnknown(v)) return;
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
        return topN(counter, n).map(function (e) {
            return { name: translateType(e.name), count: e.count };
        });
    }

    /**
     * Build a treemap tree (country → reference type). Structure matches
     * what C.treemap expects.
     */
    function buildTreemap(rows) {
        var byCountry = {};
        rows.forEach(function (row) {
            var type = translateType(getRefType(row));
            var countries = parsePipe(row.country);
            if (countries.length === 0) return;
            countries.forEach(function (country) {
                if (P.isUnknown(country)) return;
                if (!byCountry[country]) byCountry[country] = {};
                byCountry[country][type] = (byCountry[country][type] || 0) + 1;
            });
        });

        var children = Object.keys(byCountry)
            .map(function (country) {
                var types = byCountry[country];
                var typeChildren = Object.keys(types)
                    .map(function (t) { return { name: t, value: types[t] }; })
                    .sort(function (a, b) { return b.value - a.value; });
                var total = typeChildren.reduce(function (s, c) { return s + c.value; }, 0);
                return { name: country, value: total, children: typeChildren };
            })
            .sort(function (a, b) { return b.value - a.value; });

        return { name: 'References', children: children };
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, summary) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        root.appendChild(P.buildSummaryCards([
            { value: summary.total,      labelKey: 'References' },
            { value: summary.authors,    labelKey: 'Authors' },
            { value: summary.publishers, labelKey: 'Publishers' },
            { value: summary.types,      labelKey: 'Reference types' },
            { value: summary.countries,  labelKey: 'Countries' },
            { value: summary.languages,  labelKey: 'Languages' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('References by type over time'));
        var typesPanel     = P.buildPanel('iwac-vis-panel', P.t('Reference types'));
        var languagesPanel = P.buildPanel('iwac-vis-panel', P.t('Languages represented'));
        var countriesPanel = P.buildPanel('iwac-vis-panel', P.t('Content by country'));
        var authorsPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top authors'));
        var subjectsPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top subjects'));
        var treemapPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'));

        grid.appendChild(timelinePanel.panel);
        grid.appendChild(typesPanel.panel);
        grid.appendChild(languagesPanel.panel);
        grid.appendChild(countriesPanel.panel);
        grid.appendChild(authorsPanel.panel);
        grid.appendChild(subjectsPanel.panel);
        grid.appendChild(treemapPanel.panel);

        return {
            timeline:  timelinePanel.chart,
            types:     typesPanel.chart,
            languages: languagesPanel.chart,
            countries: countriesPanel.chart,
            authors:   authorsPanel.chart,
            subjects:  subjectsPanel.chart,
            treemap:   treemapPanel.chart
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initReferencesOverview(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Fetching references…');

        fetchAllReferences()
            .then(function (rows) {
                if (!rows || rows.length === 0) {
                    container.innerHTML = '';
                    container.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                    return;
                }

                var summary = summarize(rows);
                var h = buildLayout(container, summary);

                // 1. Timeline
                var timeline = timelineByType(rows);
                if (timeline.years.length > 0) {
                    ns.registerChart(h.timeline, function (el, chart) {
                        chart.setOption(C.timeline(timeline));
                    });
                }

                // 2. Reference types (horizontal bar)
                var types = typeDistribution(rows, TOP_N_TYPES);
                if (types.length > 0) {
                    ns.registerChart(h.types, function (el, chart) {
                        chart.setOption(C.horizontalBar(types));
                    });
                }

                // 3. Languages (pie)
                var languages = topN(countByPipe(rows, 'language'), 10);
                if (languages.length > 0) {
                    ns.registerChart(h.languages, function (el, chart) {
                        chart.setOption(C.pie(languages));
                    });
                }

                // 4. Countries (horizontal bar)
                var countries = topN(countByPipe(rows, 'country'), 10);
                if (countries.length > 0) {
                    ns.registerChart(h.countries, function (el, chart) {
                        chart.setOption(C.horizontalBar(countries));
                    });
                }

                // 5. Top authors
                var authors = topN(countByPipe(rows, 'author'), TOP_N_AUTHORS);
                if (authors.length > 0) {
                    ns.registerChart(h.authors, function (el, chart) {
                        chart.setOption(C.horizontalBar(authors));
                    });
                }

                // 6. Top subjects
                var subjects = topN(countByPipe(rows, 'subject'), TOP_N_SUBJECTS);
                if (subjects.length > 0) {
                    ns.registerChart(h.subjects, function (el, chart) {
                        chart.setOption(C.horizontalBar(subjects));
                    });
                }

                // 7. Treemap country → type
                var treemap = buildTreemap(rows);
                if (treemap.children && treemap.children.length > 0) {
                    ns.registerChart(h.treemap, function (el, chart) {
                        chart.setOption(C.treemap(treemap));
                    });
                }
            })
            .catch(function (err) {
                console.error('IWACVis references overview:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
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
