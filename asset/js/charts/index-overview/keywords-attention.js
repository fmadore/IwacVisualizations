/**
 * IWAC Visualizations — Index Overview: Geographic attention over time
 *
 * ROADMAP 9.8: an always-on 6-country choropleth with a year slider —
 * how the press corpus's spatial-coverage tagging of each IWAC country
 * shifts over time. Data is the Keyword Explorer's already-fetched
 * spatial bundle (global_series carries per-year counts for the country
 * keywords); no new precompute.
 *
 * The color scale is pinned to the all-years maximum (choropleth.js
 * `paint.fixedMax`) so scrubbing the slider compares honestly across
 * years instead of re-normalizing every frame.
 *
 * Load order: after panels.js + maplibre.js + choropleth.js, before the
 * index-overview orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.index-overview/keywords-attention: panels.js must load first');
        return;
    }

    var IWAC_COUNTRIES = ['Bénin', 'Burkina Faso', "Côte d'Ivoire", 'Niger', 'Nigeria', 'Togo'];
    var TICK_MS = 700;

    function render(panelEl, spatial, ctx) {
        var years = (spatial && spatial.years) || [];
        var series = (spatial && spatial.global_series) || {};

        // Per-country aligned counts; countries missing from the top-100
        // pool (shouldn't happen — they are the most frequent spatial
        // terms) fall back to all-zero rows.
        var byCountry = {};
        var fixedMax = 1;
        var hasAny = false;
        IWAC_COUNTRIES.forEach(function (c) {
            var counts = (series[c] && series[c].counts) || [];
            byCountry[c] = years.map(function (_, i) { return counts[i] || 0; });
            byCountry[c].forEach(function (v) {
                if (v > 0) hasAny = true;
                if (v > fixedMax) fixedMax = v;
            });
        });
        if (!years.length || !hasAny) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var state = { yearIdx: 0 };

        function countsAt(idx) {
            var out = {};
            IWAC_COUNTRIES.forEach(function (c) { out[c] = byCountry[c][idx] || 0; });
            return out;
        }

        // --- Controls row: play button + slider + year label ------------
        var controls = P.el('div', 'iwac-vis-keywords-attention-controls');
        var playBtn = P.el('button', 'iwac-vis-btn iwac-vis-keywords-attention-play', '▶');
        playBtn.type = 'button';
        playBtn.setAttribute('aria-label', P.t('Play'));
        controls.appendChild(playBtn);
        controls.appendChild(P.el('span', 'iwac-vis-keywords-attention-edge', String(years[0])));
        var slider = P.el('input', 'iwac-vis-keywords-attention-slider');
        slider.type = 'range';
        slider.min = '0';
        slider.max = String(years.length - 1);
        slider.step = '1';
        slider.value = '0';
        slider.setAttribute('aria-label', P.t('Year'));
        controls.appendChild(slider);
        controls.appendChild(P.el('span', 'iwac-vis-keywords-attention-edge',
            String(years[years.length - 1])));
        var yearLabel = P.el('span', 'iwac-vis-keywords-attention-year', String(years[0]));
        controls.appendChild(yearLabel);
        panelEl.chart.appendChild(controls);

        var mapEl = P.el('div', 'iwac-vis-map iwac-vis-keywords-attention-map');
        mapEl.setAttribute('aria-label', P.t('Geographic attention over time'));
        panelEl.chart.appendChild(mapEl);

        // --- Map + always-on choropleth ----------------------------------
        // MapLibre is an ES module the page loader imports in PARALLEL with
        // the classic script chain, so at render() time the global routinely
        // does not exist yet — reading it synchronously here painted a
        // permanent error over a panel that would have worked a second later.
        // The year slider and the play button are pure DOM and stay live while
        // the import settles; `setYear` already no-ops on a null choropleth.
        var choropleth = null;
        P.withMaplibre(mapEl, function () {
            var map = P.createIwacMap(mapEl, {
                center: [2.5, 10.5],
                zoom: 3.4,
                onStyleReady: function () { /* choropleth re-adds itself */ }
            });
            if (!map) return false;
            if (typeof P.attachChoroplethToggle === 'function') {
                // Open on whatever year the reader has already scrubbed to,
                // not on year 0 — the controls were live during the import.
                choropleth = P.attachChoroplethToggle(map, {
                    countryCounts: countsAt(state.yearIdx),
                    bubbleLayers: [],
                    basePath: (ctx && ctx.basePath) || '',
                    labelKey: 'mentions',
                    hideDefaultControl: true,
                    hoverInfo: true,
                    paint: { fixedMax: fixedMax }
                });
                choropleth.setMode('choropleth');
            }
            return true;
        }).then(function (ok) {
            // Genuine failure: withMaplibre has put the banner up, so retire
            // the transport that now drives nothing.
            if (ok !== true) controls.style.display = 'none';
        });

        function setYear(idx, fromTimer) {
            state.yearIdx = idx;
            yearLabel.textContent = String(years[idx]);
            if (!fromTimer) slider.value = String(idx);
            if (choropleth) {
                choropleth.updateCounts(countsAt(idx), {
                    paint: { fixedMax: fixedMax }
                });
            }
        }

        // Timer semantics (rewind-at-end, auto-stop on the last frame)
        // come from the shared playback state machine; this panel keeps
        // only its play-button glyph wiring.
        var playback = P.createPlaybackTimer({
            tickMs: TICK_MS,
            isAtEnd: function () { return state.yearIdx >= years.length - 1; },
            rewind: function () { setYear(0); },
            advance: function () {
                slider.value = String(state.yearIdx + 1);
                setYear(state.yearIdx + 1, true);
            },
            onPlay: function () {
                playBtn.textContent = '⏸';
                playBtn.setAttribute('aria-label', P.t('Pause'));
            },
            onStop: function () {
                playBtn.textContent = '▶';
                playBtn.setAttribute('aria-label', P.t('Play'));
            }
        });

        playBtn.addEventListener('click', function () { playback.toggle(); });
        slider.addEventListener('input', function () {
            playback.stop();
            setYear(parseInt(slider.value, 10) || 0);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsAttention = { render: render };
})();
