/**
 * IWAC Visualizations — Person + Entity Dashboards: AI sentiment panel
 *
 * Shows the polarité + centralité distribution of articles mentioning
 * this entity, faceted by AI model (Gemini / ChatGPT / Mistral). The
 * model picker is a P.buildFacetButtons group inside the panel; the
 * polarité and centralité bars update in place.
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

    /** Read a CSS custom property from document.body, trimmed. */
    function readVar(name) {
        if (typeof getComputedStyle === 'undefined' || !document.body) return '';
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    /**
     * Build the segment-name → CSS color maps by reading the semantic
     * tokens in iwac-core.css. Recomputed every render so a
     * theme/palette swap propagates without remounting the panel.
     */
    function readPalettes() {
        return {
            polarite: {
                'Très positif':   readVar('--iwac-vis-sent-pos-strong'),
                'Positif':        readVar('--iwac-vis-sent-pos'),
                'Neutre':         readVar('--iwac-vis-sent-neutral'),
                'Négatif':        readVar('--iwac-vis-sent-neg'),
                'Très négatif':   readVar('--iwac-vis-sent-neg-strong'),
                'Non applicable': readVar('--iwac-vis-sent-na')
            },
            centralite: {
                'Très central': readVar('--iwac-vis-cent-1'),
                'Central':      readVar('--iwac-vis-cent-2'),
                'Secondaire':   readVar('--iwac-vis-cent-3'),
                'Marginal':     readVar('--iwac-vis-cent-4'),
                'Non abordé':   readVar('--iwac-vis-cent-na')
            },
            // Subjectivité 1..5 — sequential, 1 = objective, 5 = very subjective.
            subjectivite: {
                '1': readVar('--iwac-vis-subj-1'),
                '2': readVar('--iwac-vis-subj-2'),
                '3': readVar('--iwac-vis-subj-3'),
                '4': readVar('--iwac-vis-subj-4'),
                '5': readVar('--iwac-vis-subj-5')
            }
        };
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.sentiment && data.sentiment.by_role) || {};

        // Sentiment panel has its OWN sub-facet (model picker). Tracked
        // locally so the role facet doesn't reset the chosen model.
        var activeModel = 'gemini';

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
                        fallbackColor: readVar('--iwac-vis-sent-neutral')
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

        var picker = P.buildFacetButtons({
            facets: [
                { key: 'gemini',  label: P.t('Gemini') },
                { key: 'chatgpt', label: P.t('ChatGPT') },
                { key: 'mistral', label: P.t('Mistral') }
            ],
            activeKey: activeModel,
            onChange: function (e) {
                activeModel = e.facet;
                refresh();
            }
        });
        pickerHost.appendChild(picker.root);

        refresh();
        facet.subscribe(function () { refresh(); });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.sentiment = { render: render };
})();
