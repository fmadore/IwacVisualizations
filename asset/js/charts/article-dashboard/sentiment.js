/**
 * IWAC Visualizations — Article Dashboard: AI sentiment panel
 *
 * 3-model (Gemini / ChatGPT / Mistral) sentiment comparison for THIS
 * one article. Data comes in the same bucket-histogram shape as the
 * aggregate person / entity sentiment panel — count=1 in the bucket
 * the model picked, 0 elsewhere — so we reuse C.segmentedBar and the
 * same CSS color tokens unchanged.
 *
 * The article view has no role facet; `data.sentiment` is a flat
 * object (not `data.sentiment.by_role.all`). This is the only delta
 * from the person/entity sentiment.js module.
 *
 * With only count=1 per bar, the segmentedBar renders a single 100%
 * wide stripe — which is exactly what we want for a per-article
 * view: the reader sees at a glance which bucket the AI landed in,
 * and the caption names it explicitly below ("Gemini: Positif,
 * Très central, Subjectivity 3").
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.segmentedBar || !P.buildFacetButtons) {
        console.warn('IWACVis.article-dashboard/sentiment: missing deps (need C.segmentedBar + P.buildFacetButtons)');
        return;
    }

    /** Read a CSS custom property from document.body, trimmed. */
    function readVar(name) {
        if (typeof getComputedStyle === 'undefined' || !document.body) return '';
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    /** Palette shared with the aggregate sentiment panel — keyed on raw French category names. */
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
            subjectivite: {
                '1': readVar('--iwac-vis-subj-1'),
                '2': readVar('--iwac-vis-subj-2'),
                '3': readVar('--iwac-vis-subj-3'),
                '4': readVar('--iwac-vis-subj-4'),
                '5': readVar('--iwac-vis-subj-5')
            }
        };
    }

    /** Find the only bucket with count > 0, for the caption. */
    function firstHit(buckets) {
        if (!buckets) return null;
        for (var i = 0; i < buckets.length; i++) {
            if ((buckets[i].count || 0) > 0) return buckets[i].name;
        }
        return null;
    }

    function render(panelEl, data /*, facet */) {
        var sentiment = (data && data.sentiment) || { models: [], by_model: {} };
        var activeModel = 'gemini';

        function currentModel() {
            return (sentiment.by_model || {})[activeModel];
        }
        function hasData() {
            var m = currentModel();
            return m && (m.polarite && m.polarite.length > 0
                      || m.centralite && m.centralite.length > 0
                      || m.subjectivite && m.subjectivite.length > 0);
        }

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

        var emptyEl = P.el('div', 'iwac-vis-empty', P.t('No data available'));
        emptyEl.style.display = 'none';
        host.appendChild(emptyEl);

        function paint(instance, segments, palette, axisLabel) {
            if (segments && segments.length > 0) {
                instance.setOption(
                    C.segmentedBar(segments, {
                        colors: palette,
                        axisLabel: axisLabel,
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

            // Per-article caption names the chosen buckets so the bars
            // aren't ambiguous when a single 100%-wide stripe is all
            // there is to see.
            var pol = firstHit(m.polarite);
            var cen = firstHit(m.centralite);
            var sub = firstHit(m.subjectivite);
            var parts = [];
            if (pol) parts.push(P.t('Polarity') + ': ' + P.t(pol));
            if (cen) parts.push(P.t('Centrality') + ': ' + P.t(cen));
            if (sub) parts.push(P.t('Subjectivity') + ': ' + P.t(sub));
            caption.textContent = parts.join(' \u00B7 ');
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
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.sentiment = { render: render };
})();
