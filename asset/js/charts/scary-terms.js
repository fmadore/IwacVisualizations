/**
 * IWAC Visualizations — Scary Terms block (orchestrator)
 *
 * Self-contained controller for the Scary Terms page block. Fetches the
 * four precomputed JSON files in `asset/data/`, builds the DOM (metric
 * cards + controls + chart + term definitions), and drives a horizontal
 * bar chart with three view modes:
 *
 *   - race    animated year-by-year "bar chart race" (1961–2025)
 *   - country top families for a single selected country
 *   - global  top families across the whole collection
 *
 * Term family colors come from the registered IWAC ECharts palette so
 * dark / light modes + admin-configured primary colors flow through.
 *
 * Dependencies (in load order before this file):
 *   echarts → iwac-i18n.js → iwac-theme.js → dashboard-core.js →
 *   panels.js → responsive.js → chart-options.js
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.scaryTerms: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    // Stateless builders + i18n strings live in companion files
    // (scary-terms/helpers.js, scary-terms/i18n.js), loaded before this
    // orchestrator. Alias the builders locally so the call sites below
    // read exactly as they did before the split.
    var SH = ns.scaryTerms || {};
    var buildTermColorMap = SH.buildTermColorMap;
    var buildMetricCards = SH.buildMetricCards;
    var buildTermDefinitions = SH.buildTermDefinitions;
    var buildCumulativeSnapshots = SH.buildCumulativeSnapshots;

    var DATA_FILES = {
        metadata:     'scary-terms-metadata.json',
        temporal:     'scary-terms-temporal.json',
        countries:    'scary-terms-countries.json',
        global:       'scary-terms-global.json',
        cooccurrence: 'scary-terms-cooccurrence.json'
    };

    var TOP_N = 10;
    var RACE_TICK_MS = 1000;


    // ---------------------------------------------------------------------
    //  Boot
    // ---------------------------------------------------------------------

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis.scaryTerms: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-scary');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ---------------------------------------------------------------------
    //  Per-block initialization
    // ---------------------------------------------------------------------

    function initBlock(container) {
        var basePath = container.dataset.basePath || '';
        var dataBase = basePath + '/modules/IwacVisualizations/asset/data/';

        Promise.all([
            fetchJSON(dataBase + DATA_FILES.metadata),
            fetchJSON(dataBase + DATA_FILES.temporal),
            fetchJSON(dataBase + DATA_FILES.countries),
            fetchJSON(dataBase + DATA_FILES.global),
            // Co-occurrence is optional — older deploys may not have it
            // yet. Fall back to null so the orchestrator can hide the
            // matrix view button when the bundle is missing.
            fetchJSON(dataBase + DATA_FILES.cooccurrence).catch(function () { return null; })
        ]).then(function (results) {
            render(container, {
                metadata:     results[0],
                temporal:     results[1],
                countries:    results[2],
                global:       results[3],
                cooccurrence: results[4]
            });
        }).catch(function (err) {
            console.error('IWACVis.scaryTerms:', err);
            container.innerHTML = '';
            container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
        });
    }

    function fetchJSON(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return r.json();
        });
    }

    // ---------------------------------------------------------------------
    //  Layout
    // ---------------------------------------------------------------------

    function render(container, bundle) {
        var metadata     = bundle.metadata     || {};
        var temporal     = bundle.temporal     || {};
        var countries    = bundle.countries    || {};
        var globalData   = bundle.global       || {};
        var cooccurrence = bundle.cooccurrence || null;

        var families = metadata.term_families || [];
        var termColors = buildTermColorMap(families);

        var years = [];
        if (metadata.year_range && metadata.year_range.length === 2) {
            for (var y = metadata.year_range[0]; y <= metadata.year_range[1]; y++) {
                years.push(y);
            }
        }
        var availableCountries = (metadata.countries || []).slice();

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-scary-root');
        container.appendChild(root);

        // 1. Header
        var header = P.el('div', 'iwac-vis-scary-header');
        header.appendChild(P.el('h3', 'iwac-vis-scary-title', P.t('scary.title')));
        header.appendChild(P.el('p', 'iwac-vis-scary-desc', P.t('scary.description')));
        root.appendChild(header);

        // 2. Metric cards
        root.appendChild(buildMetricCards(metadata, globalData));

        // 3. Controls
        var controlsEl = P.el('div', 'iwac-vis-scary-controls');
        root.appendChild(controlsEl);

        // 4. Chart panel
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-scary-panel');
        var chartHeader = P.el('div', 'iwac-vis-scary-chart-header');
        var chartTitle = P.el('h4', 'iwac-vis-scary-chart-title');
        var topBadge   = P.el('span', 'iwac-vis-scary-badge');
        chartHeader.appendChild(chartTitle);
        chartHeader.appendChild(topBadge);
        panel.appendChild(chartHeader);
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-scary-chart');
        panel.appendChild(chartEl);
        root.appendChild(panel);

        // 5. Term definitions
        root.appendChild(buildTermDefinitions(metadata));

        // Pre-compute one cumulative snapshot per year. The bar chart race
        // shows running totals (matching the iwac-dashboard semantics), so
        // bars grow monotonically as the race advances — they never shrink.
        // The x-axis intentionally adapts per frame: pinning it to the final
        // total made every early year render as a sliver against a ~4500-
        // wide scale, which was the user's top complaint.
        var cumulativeByYearIdx = buildCumulativeSnapshots(temporal, years);

        var matrixCountries = cooccurrence && cooccurrence.countries
            ? Object.keys(cooccurrence.countries).sort()
            : [];

        var state = {
            view: 'race',
            country: availableCountries[0] || null,
            matrixCountry: null,  // null = global; otherwise one of matrixCountries
            yearIdx: 0,
            isPlaying: false,
            timer: null
        };

        // Holds the CURRENT ECharts instance. dashboard-core re-runs this
        // render callback with a fresh instance on every theme swap
        // (dispose + reinit), so we must capture the new instance here
        // rather than closing over the initial return value — otherwise
        // draw() keeps calling setOption on a disposed chart after the
        // first light/dark toggle and the chart goes blank.
        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            draw();
        });

        function draw() {
            if (!currentInstance || currentInstance.isDisposed()) return;
            // Toggle a view-specific modifier class on the panel so
            // CSS can bump the chart min-height for dense views (e.g.
            // the 12×12 co-occurrence matrix) without affecting the
            // bar-chart race / country / global layouts.
            panel.classList.toggle('iwac-vis-scary-panel--matrix', state.view === 'matrix');
            var option = null;
            if (state.view === 'race') {
                var year = years[state.yearIdx];
                var yearData = (cumulativeByYearIdx[state.yearIdx] || []).slice(0, TOP_N);
                option = C.scaryTerms({
                    entries: yearData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.chart_title') + ' \u2014 ' + year;
                topBadge.textContent = yearData[0]
                    ? P.t('scary.top_term') + ': ' + yearData[0][0]
                    : '';
            } else if (state.view === 'country') {
                var c = state.country;
                var cData = ((countries[c] || {}).data || []);
                option = C.scaryTerms({
                    entries: cData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.country_chart_title', { country: c || '' });
                topBadge.textContent = cData[0]
                    ? P.t('scary.top_term') + ': ' + cData[0][0]
                    : '';
            } else if (state.view === 'matrix') {
                var slice = resolveMatrixSlice();
                option = buildMatrixOption(slice);
                var matrixCountry = state.matrixCountry;
                chartTitle.textContent = matrixCountry
                    ? P.t('scary.matrix_country_chart_title', { country: matrixCountry })
                    : P.t('scary.matrix_chart_title');
                topBadge.textContent = slice && slice.total_articles
                    ? P.t('scary.matrix_articles', { count: P.formatNumber(slice.total_articles) })
                    : '';
            } else {
                var gData = globalData.data || [];
                option = C.scaryTerms({
                    entries: gData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.global_chart_title');
                topBadge.textContent = gData[0]
                    ? P.t('scary.top_term') + ': ' + gData[0][0]
                    : '';
            }
            if (option) currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
        }

        // -----------------------------------------------------------------
        //  Co-occurrence matrix
        //
        //  ECharts heatmap with category × category axes. Data is the
        //  precomputed term × term matrix keyed by the canonical term
        //  order from metadata.term_families. Uses the IWAC palette
        //  primary + surface tokens for the color ramp so light / dark
        //  theme swaps track automatically via dashboard-core's
        //  dispose+reinit path (the registerChart callback wraps draw()).
        // -----------------------------------------------------------------

        function resolveMatrixSlice() {
            if (!cooccurrence) return null;
            if (state.matrixCountry && cooccurrence.countries
                && cooccurrence.countries[state.matrixCountry]) {
                return cooccurrence.countries[state.matrixCountry];
            }
            return cooccurrence.global || null;
        }

        function buildMatrixOption(slice) {
            // Resolve every color through CSS custom properties so the
            // matrix tracks the IWAC theme's --primary / --surface /
            // --ink / --muted tokens on light/dark swap. Fallbacks are
            // only consulted when the theme isn't installed. Never
            // hardcode hex values in chart code.
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var primaryResolved = (ns.resolveCssVar && ns.resolveCssVar('--primary'))
                || tokens.primary || '#d86a11';
            var surfaceResolved = (ns.resolveCssVar && ns.resolveCssVar('--surface-raised'))
                || tokens.surfaceRaised || tokens.surface || '#f7f4ee';
            var inkResolved = (ns.resolveCssVar && ns.resolveCssVar('--ink'))
                || tokens.ink || '#1c232d';
            var mutedResolved = (ns.resolveCssVar && ns.resolveCssVar('--muted'))
                || tokens.muted || '#707f86';
            var borderResolved = (ns.resolveCssVar && ns.resolveCssVar('--border'))
                || tokens.border || '#dad5cb';

            if (!cooccurrence || !slice) {
                return {
                    graphic: [{
                        type: 'text',
                        left: 'center',
                        top: 'middle',
                        style: {
                            text: P.t('scary.matrix_empty'),
                            fill: mutedResolved,
                            font: '14px Inter, -apple-system, sans-serif'
                        }
                    }]
                };
            }
            var terms = (cooccurrence.terms || []).slice();
            var matrix = slice.matrix || [];
            var maxVal = Math.max(1, slice.max_cooccurrence || 1);

            // Flatten to [xIdx, yIdx, value] triples. The diagonal is
            // left as 0 because self-co-occurrence is meaningless —
            // the tooltip covers the per-term totals via term_counts.
            var data = [];
            for (var i = 0; i < terms.length; i++) {
                for (var j = 0; j < terms.length; j++) {
                    if (i === j) continue;
                    var v = (matrix[i] && matrix[i][j]) || 0;
                    data.push([i, j, v]);
                }
            }

            return {
                tooltip: {
                    trigger: 'item',
                    formatter: function (p) {
                        var x = terms[p.value[0]];
                        var y = terms[p.value[1]];
                        var count = p.value[2];
                        return P.t('scary.matrix_pair_tooltip', {
                            a: x,
                            b: y,
                            count: P.formatNumber(count || 0)
                        });
                    }
                },
                grid: {
                    left: 120,
                    right: 24,
                    top: 30,
                    bottom: 70,
                    containLabel: true
                },
                xAxis: {
                    type: 'category',
                    data: terms,
                    axisLabel: {
                        rotate: 45,
                        interval: 0,
                        color: mutedResolved
                    },
                    axisLine:  { lineStyle: { color: borderResolved } },
                    splitArea: { show: false },
                    axisTick:  { show: false }
                },
                yAxis: {
                    type: 'category',
                    data: terms.slice(),
                    inverse: true,
                    axisLabel: { interval: 0, color: mutedResolved },
                    axisLine:  { lineStyle: { color: borderResolved } },
                    splitArea: { show: false },
                    axisTick:  { show: false }
                },
                visualMap: {
                    min: 0,
                    max: maxVal,
                    calculable: true,
                    orient: 'horizontal',
                    left: 'center',
                    bottom: 4,
                    itemWidth: 14,
                    itemHeight: 140,
                    textStyle: { color: mutedResolved },
                    inRange: {
                        color: [surfaceResolved, primaryResolved]
                    }
                },
                series: [{
                    type: 'heatmap',
                    data: data,
                    label: {
                        show: true,
                        formatter: function (p) {
                            var v = p.value[2];
                            return v > 0 ? v : '';
                        },
                        color: inkResolved,
                        fontSize: 11
                    },
                    itemStyle: { borderColor: surfaceResolved, borderWidth: 1 },
                    emphasis: {
                        itemStyle: {
                            borderColor: primaryResolved,
                            borderWidth: 2
                        }
                    },
                    progressive: 0,
                    animation: false
                }]
            };
        }

        // -----------------------------------------------------------------
        //  Controls rendering
        //
        //  Re-renders the controls row whenever the view mode changes so
        //  the country dropdown / playback bar / slider appear only for
        //  the relevant view. The chart itself is not reinitialized.
        // -----------------------------------------------------------------

        function renderControls() {
            controlsEl.innerHTML = '';
            var row = P.el('div', 'iwac-vis-scary-controls-row');
            controlsEl.appendChild(row);

            row.appendChild(buildViewToggle());

            if (state.view === 'country' && availableCountries.length) {
                row.appendChild(buildCountrySelect());
            }
            if (state.view === 'matrix' && matrixCountries.length) {
                row.appendChild(buildMatrixCountrySelect());
            }
            if (state.view === 'matrix') {
                var desc = P.el('p', 'iwac-vis-scary-matrix-desc',
                    P.t('scary.matrix_description'));
                controlsEl.appendChild(desc);
            }
            if (state.view === 'race' && years.length) {
                row.appendChild(buildPlaybackGroup());
                controlsEl.appendChild(buildSliderRow());
            }
        }

        function buildViewToggle() {
            var group = P.el('div', 'iwac-vis-scary-view-toggle');
            group.appendChild(P.el('span', 'iwac-vis-scary-label', P.t('scary.view_mode') + ':'));
            var views = [
                { key: 'race',    label: P.t('scary.bar_race') },
                { key: 'country', label: P.t('scary.by_country') },
                { key: 'global',  label: P.t('scary.global_view') }
            ];
            // The matrix view is only offered when the cooccurrence
            // bundle is present — older deploys won't have it yet.
            if (cooccurrence) {
                views.push({ key: 'matrix', label: P.t('scary.matrix') });
            }
            views.forEach(function (v) {
                var btn = P.el('button', 'iwac-vis-scary-view-btn', v.label);
                btn.type = 'button';
                if (state.view === v.key) {
                    btn.classList.add('iwac-vis-scary-view-btn--active');
                }
                btn.addEventListener('click', function () {
                    if (state.view === v.key) return;
                    pauseTimer();
                    state.view = v.key;
                    if (v.key === 'country' && !state.country && availableCountries.length) {
                        state.country = availableCountries[0];
                    }
                    renderControls();
                    draw();
                });
                group.appendChild(btn);
            });
            return group;
        }

        function buildCountrySelect() {
            var group = P.el('div', 'iwac-vis-scary-country-group');
            var label = P.el('label', 'iwac-vis-scary-label', P.t('scary.country') + ':');
            var select = P.el('select', 'iwac-vis-scary-select');
            var selectId = 'iwac-vis-scary-country-' + Math.random().toString(36).slice(2, 8);
            select.id = selectId;
            label.htmlFor = selectId;
            availableCountries.forEach(function (c) {
                var opt = P.el('option', null, c);
                opt.value = c;
                if (c === state.country) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                state.country = select.value;
                draw();
            });
            group.appendChild(label);
            group.appendChild(select);
            return group;
        }

        function buildMatrixCountrySelect() {
            // Separate from buildCountrySelect so the two views keep
            // independent selections (the matrix has an "All countries"
            // choice and a different available-country list — only
            // slices with enough data are emitted).
            var group = P.el('div', 'iwac-vis-scary-country-group');
            var label = P.el('label', 'iwac-vis-scary-label', P.t('scary.country') + ':');
            var select = P.el('select', 'iwac-vis-scary-select');
            var selectId = 'iwac-vis-scary-matrix-country-' + Math.random().toString(36).slice(2, 8);
            select.id = selectId;
            label.htmlFor = selectId;

            var allOpt = P.el('option', null, P.t('scary.all_countries'));
            allOpt.value = '';
            if (!state.matrixCountry) allOpt.selected = true;
            select.appendChild(allOpt);

            matrixCountries.forEach(function (c) {
                var opt = P.el('option', null, c);
                opt.value = c;
                if (c === state.matrixCountry) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                state.matrixCountry = select.value || null;
                draw();
            });
            group.appendChild(label);
            group.appendChild(select);
            return group;
        }

        function buildPlaybackGroup() {
            var group = P.el('div', 'iwac-vis-scary-playback');
            group.appendChild(ctrlButton('\u25C0', P.t('scary.previous'), stepBackward));
            var isAtEnd = state.yearIdx >= years.length - 1;
            var playBtn = ctrlButton(
                state.isPlaying ? '\u23F8' : '\u25B6',
                state.isPlaying ? P.t('scary.pause') : P.t('scary.play'),
                state.isPlaying ? pause : play
            );
            playBtn.classList.add('iwac-vis-scary-play-btn');
            if (isAtEnd && !state.isPlaying) {
                // Allow pressing play at the end — it will rewind.
            }
            group.appendChild(playBtn);
            group.appendChild(ctrlButton('\u25B6', P.t('scary.next'), stepForward));
            group.appendChild(ctrlButton('\u21BA', P.t('scary.reset'), reset));
            var yearLabel = P.el('span', 'iwac-vis-scary-year-label',
                                 String(years[state.yearIdx] || ''));
            group.appendChild(yearLabel);
            return group;
        }

        function buildSliderRow() {
            var sliderRow = P.el('div', 'iwac-vis-scary-slider-row');
            sliderRow.appendChild(P.el('span', 'iwac-vis-scary-slider-edge',
                                       String(years[0])));
            var slider = P.el('input', 'iwac-vis-scary-slider');
            slider.type = 'range';
            slider.min = '0';
            slider.max = String(years.length - 1);
            slider.value = String(state.yearIdx);
            slider.step = '1';
            slider.setAttribute('aria-label', P.t('Year'));
            syncSliderFill(slider);
            slider.addEventListener('input', function () {
                pauseTimer();
                state.isPlaying = false;
                state.yearIdx = parseInt(slider.value, 10) || 0;
                syncSliderFill(slider);
                // Reach into the sibling year label without re-rendering
                // the whole controls block (cheaper; avoids slider focus loss).
                var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
                if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
                draw();
            });
            sliderRow.appendChild(slider);
            sliderRow.appendChild(P.el('span', 'iwac-vis-scary-slider-edge',
                                       String(years[years.length - 1])));
            return sliderRow;
        }

        /**
         * Paint the left-side progress fill of a range input by writing
         * the ``--iwac-vis-scary-fill`` CSS variable. Called on slider
         * build, on user input, and on every playback tick so the
         * gradient stops match the current yearIdx.
         */
        function syncSliderFill(slider) {
            var max = parseFloat(slider.max) || 1;
            var val = parseFloat(slider.value) || 0;
            var pct = max > 0 ? (val / max) * 100 : 0;
            slider.style.setProperty('--iwac-vis-scary-fill', pct + '%');
        }

        function ctrlButton(glyph, title, handler) {
            var btn = P.el('button', 'iwac-vis-scary-ctrl-btn', glyph);
            btn.type = 'button';
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.addEventListener('click', handler);
            return btn;
        }

        // -----------------------------------------------------------------
        //  Playback
        // -----------------------------------------------------------------

        function pauseTimer() {
            if (state.timer) {
                window.clearInterval(state.timer);
                state.timer = null;
            }
        }

        function play() {
            if (state.view !== 'race' || !years.length) return;
            if (state.yearIdx >= years.length - 1) state.yearIdx = 0;
            state.isPlaying = true;
            pauseTimer();
            state.timer = window.setInterval(function () {
                if (state.yearIdx >= years.length - 1) {
                    pause();
                    return;
                }
                state.yearIdx++;
                syncSliderPosition();
                draw();
            }, RACE_TICK_MS);
            renderControls();
            draw();
        }

        function pause() {
            pauseTimer();
            state.isPlaying = false;
            renderControls();
        }

        function stepBackward() {
            pauseTimer();
            state.isPlaying = false;
            if (state.yearIdx > 0) state.yearIdx--;
            renderControls();
            draw();
        }

        function stepForward() {
            pauseTimer();
            state.isPlaying = false;
            if (state.yearIdx < years.length - 1) state.yearIdx++;
            renderControls();
            draw();
        }

        function reset() {
            pauseTimer();
            state.isPlaying = false;
            state.yearIdx = 0;
            renderControls();
            draw();
        }

        function syncSliderPosition() {
            var slider = controlsEl.querySelector('.iwac-vis-scary-slider');
            if (slider) {
                slider.value = String(state.yearIdx);
                syncSliderFill(slider);
            }
            var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
            if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
        }

        // Initial paint
        renderControls();
        draw();
    }

})();
