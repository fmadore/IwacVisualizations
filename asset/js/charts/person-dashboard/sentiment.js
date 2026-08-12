/**
 * IWAC Visualizations — Person + Entity Dashboards: AI sentiment panel
 *
 * Shows the polarité + centralité distribution of articles mentioning
 * this entity, faceted by AI model (GPT-5.6 Luna / Mistral Small 4 /
 * DeepSeek V4 Flash). The model picker is a P.buildFacetButtons group
 * inside the panel; the polarité and centralité bars update in place.
 *
 * Only the articles subset carries sentiment fields; publications and
 * references are silently dropped at the precompute level.
 *
 * Reuses C.segmentedBar from chart-options.js — no inline ECharts
 * configuration here. Colors come from the --iwac-vis-sent-* and
 * --iwac-vis-cent-* CSS variables defined in iwac-core.css,
 * which themselves reference IWAC theme tokens. NEVER hardcode hex.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.segmentedBar || !P.buildFacetButtons) {
        console.warn('IWACVis.person-dashboard/sentiment: missing deps (need C.segmentedBar + P.buildFacetButtons)');
        return;
    }

    // The model list comes from the PAYLOAD, not from a constant here.
    //
    // Each role slice carries its own `models` array naming exactly what
    // its `by_model` map holds. This panel used to hardcode the three
    // generation-2 ids instead, which meant that between a module release
    // and the admin's next "Pull latest data" run — a window the data
    // decoupling in issue #7 makes routine — it looked up three keys the
    // deployed bundle did not have and showed "no data available" over a
    // fully populated payload. Reading the payload's own list cannot
    // desynchronise from the payload.
    //
    // P.sentimentModelLabel maps id → display name and knows both
    // generations; unknown ids still get a readable label.
    function modelsOf(slice) {
        var keys = (slice && slice.models) || [];
        var byModel = (slice && slice.by_model) || {};
        // Fall back to the map's own keys if `models` is absent: older
        // bundles predate that field, and the data is still there.
        if (!keys.length) keys = Object.keys(byModel);
        return keys.map(function (key) {
            return { key: key, label: P.sentimentModelLabel(key) };
        });
    }

    /**
     * Read a CSS colour token in the legacy rgb() form ECharts can parse
     * during hover emphasis. The browser can paint OKLCH / color-mix()
     * directly, but zrender cannot lift those modern strings and otherwise
     * redraws the hovered segment without a fill.
     */
    function readColor(name) {
        return typeof ns.readColorVar === 'function' ? ns.readColorVar(name) : '';
    }

    /**
     * Build the segment-name → CSS color maps by reading the semantic
     * tokens in iwac-core.css. Recomputed every render so a
     * theme/palette swap propagates without remounting the panel.
     */
    function readPalettes() {
        return {
            polarite: {
                'Très positif':   readColor('--iwac-vis-sent-pos-strong'),
                'Positif':        readColor('--iwac-vis-sent-pos'),
                'Neutre':         readColor('--iwac-vis-sent-neutral'),
                'Négatif':        readColor('--iwac-vis-sent-neg'),
                'Très négatif':   readColor('--iwac-vis-sent-neg-strong'),
                'Non applicable': readColor('--iwac-vis-sent-na')
            },
            centralite: {
                'Très central': readColor('--iwac-vis-cent-1'),
                'Central':      readColor('--iwac-vis-cent-2'),
                'Secondaire':   readColor('--iwac-vis-cent-3'),
                'Marginal':     readColor('--iwac-vis-cent-4'),
                'Non abordé':   readColor('--iwac-vis-cent-na')
            },
            // Subjectivité 1..5 — sequential, 1 = objective, 5 = very subjective.
            subjectivite: {
                '1': readColor('--iwac-vis-subj-1'),
                '2': readColor('--iwac-vis-subj-2'),
                '3': readColor('--iwac-vis-subj-3'),
                '4': readColor('--iwac-vis-subj-4'),
                '5': readColor('--iwac-vis-subj-5')
            }
        };
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.sentiment && data.sentiment.by_role) || {};

        // Every role slice declares the same models; take the first that
        // declares any, so the picker stays put as the reader moves
        // between roles instead of rebuilding under them.
        var models = [];
        var roles = Object.keys(byRole);
        for (var ri = 0; ri < roles.length; ri++) {
            var candidate = modelsOf(byRole[roles[ri]]);
            if (candidate.length) { models = candidate; break; }
        }

        // Sentiment panel has its OWN sub-facet (model picker). Tracked
        // locally so the role facet doesn't reset the chosen model.
        var activeModel = models.length ? models[0].key : '';

        function currentSlice() {
            return byRole[facet.role] || { models: [], by_model: {}, articles_total: 0 };
        }
        function currentModel() {
            return (currentSlice().by_model || {})[activeModel];
        }
        function hasData() {
            var m = currentModel();
            return m && m.polarite && m.polarite.length > 0;
        }

        // Mount: replace the chart container with [model picker] +
        // [caption] + [polarité chart] + [centralité chart] + [empty]
        var host = panelEl.chart;
        host.innerHTML = '';
        host.classList.add('iwac-vis-sentiment');

        var pickerHost = P.el('div', 'iwac-vis-sentiment__picker');
        host.appendChild(pickerHost);

        var caption = P.el('div', 'iwac-vis-sentiment__caption');
        host.appendChild(caption);

        var polEl = P.el('div', 'iwac-vis-sentiment__chart');
        host.appendChild(polEl);

        var cenEl = P.el('div', 'iwac-vis-sentiment__chart iwac-vis-sentiment__chart--cen');
        host.appendChild(cenEl);

        var subEl = P.el('div', 'iwac-vis-sentiment__chart iwac-vis-sentiment__chart--sub');
        host.appendChild(subEl);

        var emptyEl = P.buildEmptyState();
        emptyEl.style.display = 'none';
        host.appendChild(emptyEl);

        function paint(instance, segments, palette, axisLabel) {
            if (segments && segments.length > 0) {
                instance.setOption(
                    C.segmentedBar(segments, {
                        colors: palette,
                        axisLabel: axisLabel,
                        // Translate category names for display but keep
                        // the palette keyed on the raw French names so
                        // --iwac-vis-sent-* lookups still work.
                        labelFor: function (name) { return P.t(name); },
                        fallbackColor: readColor('--iwac-vis-sent-neutral')
                    }),
                    true
                );
            } else {
                instance.clear();
            }
        }

        var polChart = ns.registerChart(polEl, function (el, instance) {
            var m = currentModel();
            if (!m) { instance.clear(); return; }
            paint(instance, m.polarite, readPalettes().polarite, P.t('Polarity'));
        });
        var cenChart = ns.registerChart(cenEl, function (el, instance) {
            var m = currentModel();
            if (!m) { instance.clear(); return; }
            paint(instance, m.centralite, readPalettes().centralite, P.t('Centrality'));
        });
        var subChart = ns.registerChart(subEl, function (el, instance) {
            var m = currentModel();
            if (!m) { instance.clear(); return; }
            paint(instance, m.subjectivite, readPalettes().subjectivite, P.t('Subjectivity'));
        });

        function refresh() {
            var m = currentModel();
            if (!hasData()) {
                emptyEl.style.display = '';
                polEl.style.display = 'none';
                cenEl.style.display = 'none';
                subEl.style.display = 'none';
                caption.textContent = '';
                return;
            }
            emptyEl.style.display = 'none';
            polEl.style.display = '';
            cenEl.style.display = '';
            subEl.style.display = '';

            var palettes = readPalettes();
            if (polChart && !polChart.isDisposed()) {
                paint(polChart, m.polarite, palettes.polarite, P.t('Polarity'));
            }
            if (cenChart && !cenChart.isDisposed()) {
                paint(cenChart, m.centralite, palettes.centralite, P.t('Centrality'));
            }
            if (subChart && !subChart.isDisposed()) {
                paint(subChart, m.subjectivite, palettes.subjectivite, P.t('Subjectivity'));
            }

            // Caption: rated articles only. The subjectivity distribution
            // is now visible in the dedicated bar below, so the glanceable
            // summary would just duplicate what the viewer can already see.
            var rated = m.rated_articles || 0;
            caption.textContent = P.t('articles_count', { count: rated });
        }

        // A single model needs no picker, and zero means the payload
        // carries no sentiment at all — `refresh` below puts up the empty
        // state for that case, which is the honest answer. Neither should
        // render a row of buttons.
        if (models.length > 1) {
            var picker = P.buildFacetButtons({
                facets: models.map(function (m) {
                    return { key: m.key, label: m.label };
                }),
                activeKey: activeModel,
                onChange: function (e) {
                    activeModel = e.facet;
                    refresh();
                }
            });
            pickerHost.appendChild(picker.root);
        }

        refresh();
        facet.subscribe(function () { refresh(); });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.sentiment = { render: render };
})();
