/**
 * Compare Projects: side-by-side project comparison.
 *
 * Fetches the projects-index.json for dropdowns, then loads two
 * dashboard JSONs and renders paired charts with overlap statistics.
 *
 * Depends on:
 *   - dashboard-core.js   (THEME, COLORS, helpers)
 *   - dashboard-registry.js (CHART_MAP, CHART_LABELS)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    /* ------------------------------------------------------------------ */
    /*  Compare charts to display                                          */
    /* ------------------------------------------------------------------ */

    var COMPARE_CHARTS = [
        { key: 'stackedTimeline', label: 'Items by Year and Type', tall: false },
        { key: 'types',           label: 'Resource Types',         tall: false },
        { key: 'languages',       label: 'Languages',              tall: false },
        { key: 'subjects',        label: 'Subjects',               tall: true  }
    ];

    /* ------------------------------------------------------------------ */
    /*  Overlap computation                                                */
    /* ------------------------------------------------------------------ */

    function computeOverlap(leftData, rightData) {
        if (!leftData || !rightData) return null;
        var leftSubjects = extractNames(leftData.subjects);
        var rightSubjects = extractNames(rightData.subjects);
        var intersection = leftSubjects.filter(function (s) { return rightSubjects.indexOf(s) >= 0; });
        var union = leftSubjects.slice();
        rightSubjects.forEach(function (s) { if (union.indexOf(s) < 0) union.push(s); });
        return {
            percentage: union.length ? Math.round(intersection.length / union.length * 100) : 0,
            shared: intersection.slice(0, 12),
            sharedCount: intersection.length,
            totalCount: union.length
        };
    }

    function extractNames(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data.map(function (d) { return d.name || ''; });
        return Object.keys(data);
    }

    /* ------------------------------------------------------------------ */
    /*  UI builders                                                        */
    /* ------------------------------------------------------------------ */

    function buildSelector(projects, side, selectedId, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'compare-selector';

        var label = document.createElement('label');
        label.textContent = side === 'left' ? 'Project A' : 'Project B';
        label.className = 'compare-selector-label';

        var select = document.createElement('select');
        select.className = 'compare-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a project\u2026';
        placeholder.disabled = true;
        if (!selectedId) placeholder.selected = true;
        select.appendChild(placeholder);

        // Group by section
        var sections = {};
        projects.forEach(function (p) {
            var sec = (p.sections && p.sections[0]) || 'Other';
            if (!sections[sec]) sections[sec] = [];
            sections[sec].push(p);
        });

        Object.keys(sections).sort().forEach(function (sec) {
            var group = document.createElement('optgroup');
            group.label = sec;
            sections[sec].forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = truncate(p.name, 70) + ' (' + p.items + ' items)';
                opt.title = p.name;
                if (String(p.id) === String(selectedId)) opt.selected = true;
                group.appendChild(opt);
            });
            select.appendChild(group);
        });

        select.addEventListener('change', function () { onChange(select.value); });

        wrap.appendChild(label);
        wrap.appendChild(select);
        return wrap;
    }

    function buildStatsPanel(leftData, rightData) {
        var overlap = computeOverlap(leftData, rightData);
        var html = '<div class="compare-stats">';

        html += '<div class="compare-stat-card">'
            + '<span class="compare-stat-value">' + (leftData ? leftData.totalItems : '\u2014') + '</span>'
            + '<span class="compare-stat-label">Items (A)</span></div>';

        html += '<div class="compare-stat-card">'
            + '<span class="compare-stat-value">' + (rightData ? rightData.totalItems : '\u2014') + '</span>'
            + '<span class="compare-stat-label">Items (B)</span></div>';

        if (overlap) {
            html += '<div class="compare-stat-card compare-stat-accent">'
                + '<span class="compare-stat-value">' + overlap.percentage + '%</span>'
                + '<span class="compare-stat-label">Subject Overlap'
                + '<br><small>' + overlap.sharedCount + ' shared of ' + overlap.totalCount + ' total</small>'
                + '</span></div>';
        }

        html += '</div>';

        // Shared subjects badges
        if (overlap && overlap.shared.length > 0) {
            html += '<div class="compare-shared">'
                + '<span class="compare-shared-label">Shared Subjects:</span>';
            overlap.shared.forEach(function (s) {
                html += '<span class="compare-badge">' + escapeHtml(s) + '</span>';
            });
            if (overlap.sharedCount > overlap.shared.length) {
                html += '<span class="compare-badge compare-badge-muted">'
                    + '+' + (overlap.sharedCount - overlap.shared.length) + ' more</span>';
            }
            html += '</div>';
        }

        return html;
    }

    function buildChartPair(key, label, leftData, rightData, siteBase, tall) {
        var container = document.createElement('div');
        container.className = 'compare-chart-row';

        var leftPanel = buildChartSide(key, label + ' (A)', leftData, siteBase, tall);
        var rightPanel = buildChartSide(key, label + ' (B)', rightData, siteBase, tall);

        container.appendChild(leftPanel);
        container.appendChild(rightPanel);
        return container;
    }

    /** Pending chart inits — deferred until DOM is ready. */
    var pendingCharts = [];

    function buildChartSide(key, label, data, siteBase, tall) {
        var panel = document.createElement('div');
        panel.className = 'chart-panel compare-chart-panel';

        var h4 = document.createElement('h4');
        h4.textContent = label;
        panel.appendChild(h4);

        var chartData = data ? data[key] : null;
        // For stacked timeline, fall back to basic timeline
        if (!chartData && key === 'stackedTimeline' && data) {
            chartData = data.timeline;
            key = 'timeline';
        }
        var hasData = Array.isArray(chartData) ? chartData.length > 0
            : (chartData && typeof chartData === 'object' && Object.keys(chartData).length > 0);

        if (!hasData) {
            var empty = document.createElement('div');
            empty.className = 'rv-no-data';
            empty.textContent = 'No data';
            panel.appendChild(empty);
            return panel;
        }

        var el = document.createElement('div');
        el.className = 'chart-container' + (tall ? ' chart-container-tall' : '');
        el.setAttribute('data-chart', key);
        panel.appendChild(el);

        // Queue chart init — will be flushed after all panels are in the DOM.
        pendingCharts.push({ el: el, key: key, data: chartData, siteBase: siteBase, panel: panel });

        return panel;
    }

    function flushPendingCharts() {
        requestAnimationFrame(function () {
            pendingCharts.forEach(function (p) {
                if (ns.CHART_MAP && ns.CHART_MAP[p.key]) {
                    var chart = ns.CHART_MAP[p.key](p.el, p.data, p.siteBase);
                    if (chart) ns.attachToolbar(p.panel, chart);
                }
            });
            pendingCharts = [];
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function truncate(str, max) {
        return str && str.length > max ? str.substring(0, max) + '\u2026' : (str || '');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ------------------------------------------------------------------ */
    /*  Main controller                                                    */
    /* ------------------------------------------------------------------ */

    function initCompare(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        var moduleBase = basePath + '/modules/IwacVisualizations/asset/data/item-dashboards/';
        var indexUrl = moduleBase + 'projects-index.json';

        var leftId = null, rightId = null;
        var leftData = null, rightData = null;
        var projects = [];

        fetch(indexUrl).then(function (r) {
            if (!r.ok) throw new Error('Project index not found');
            return r.json();
        }).then(function (data) {
            projects = data;
            container.innerHTML = '';
            render();
        }).catch(function () {
            container.innerHTML = '<div class="rv-error">Could not load project data.</div>';
        });

        function fetchDashboard(id, callback) {
            if (!id) { callback(null); return; }
            fetch(moduleBase + id + '.json').then(function (r) {
                if (!r.ok) throw new Error('not found');
                return r.json();
            }).then(callback).catch(function () { callback(null); });
        }

        function render() {
            container.innerHTML = '';

            // Header
            var header = document.createElement('div');
            header.className = 'dashboard-header';
            header.innerHTML = '<h3>Compare Projects</h3>';
            container.appendChild(header);

            // Selectors row
            var selectors = document.createElement('div');
            selectors.className = 'compare-selectors';

            selectors.appendChild(buildSelector(projects, 'left', leftId, function (id) {
                leftId = id;
                fetchDashboard(id, function (data) { leftData = data; renderComparison(); });
            }));

            var vsSpan = document.createElement('span');
            vsSpan.className = 'compare-vs';
            vsSpan.textContent = 'vs';
            selectors.appendChild(vsSpan);

            selectors.appendChild(buildSelector(projects, 'right', rightId, function (id) {
                rightId = id;
                fetchDashboard(id, function (data) { rightData = data; renderComparison(); });
            }));

            container.appendChild(selectors);

            // Content area
            var content = document.createElement('div');
            content.className = 'compare-content';
            container.appendChild(content);

            renderComparison();
        }

        function renderComparison() {
            var content = container.querySelector('.compare-content');
            if (!content) return;
            content.innerHTML = '';

            if (!leftId && !rightId) {
                content.innerHTML = '<div class="rv-no-data">Select two projects to compare.</div>';
                return;
            }
            if (!leftId || !rightId) {
                content.innerHTML = '<div class="rv-no-data">Select a second project to compare.</div>';
                return;
            }

            // Build unified copies so both sides use consistent colors.
            var unify = ns.unifyForComparison;
            var uLeft = leftData ? JSON.parse(JSON.stringify(leftData)) : null;
            var uRight = rightData ? JSON.parse(JSON.stringify(rightData)) : null;

            if (uLeft && uRight && unify) {
                // Unify entry-based charts (bar, pie): same name order = same color index.
                ['types', 'languages', 'subjects'].forEach(function (key) {
                    var order = unify.buildUnifiedOrder(uLeft, uRight, key);
                    uLeft = unify.reorderEntries(uLeft, key, order);
                    uRight = unify.reorderEntries(uRight, key, order);
                });

                // Unify stacked charts: same series order = same color index.
                unify.unifyStackedSeries(uLeft, uRight, 'stackedTimeline');
            }

            // Stats (use original data for overlap computation)
            var statsDiv = document.createElement('div');
            statsDiv.innerHTML = buildStatsPanel(leftData, rightData);
            content.appendChild(statsDiv);

            // Chart pairs (use unified copies)
            pendingCharts = [];
            COMPARE_CHARTS.forEach(function (cfg) {
                var pair = buildChartPair(cfg.key, cfg.label, uLeft, uRight, siteBase, cfg.tall);
                content.appendChild(pair);
            });

            // Init charts now that all elements are in the DOM.
            flushPendingCharts();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        if (typeof echarts === 'undefined') return;
        var containers = document.querySelectorAll('.compare-container');
        for (var i = 0; i < containers.length; i++) {
            initCompare(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
