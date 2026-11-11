/**
 * IWAC Visualizations — Compare Newspapers block: sentiment panel.
 *
 * Split out of compare-newspapers.js. Builds the AI sentiment
 * comparison (articles only) — an axis + model toolbar driving one
 * horizontal bar chart per corpus, with placeholders for unrated
 * sides. Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/sentiment: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    // Model ids come from the PAYLOAD's own `sentiment.models` map, never
    // from a constant here — a hardcoded list silently stops matching the
    // moment the rater panel changes upstream, and the module ships
    // separately from its data, so that window is routine rather than
    // exceptional. P.sentimentModelLabel supplies the display names.
    //
    // Union of both corpora: A and B are independent bundles and may have
    // been generated against different rater panels, in which case the
    // picker should offer everything either side can answer rather than
    // silently intersecting them down to nothing.
    function modelKeys(dataA, dataB) {
        var seen = {};
        var out = [];
        [dataA, dataB].forEach(function (d) {
            var models = ((d || {}).sentiment || {}).models || {};
            Object.keys(models).forEach(function (key) {
                if (seen[key]) return;
                seen[key] = true;
                out.push(key);
            });
        });
        return out;
    }

    function buildSentiment(dataA, dataB) {
        var hasA = dataA.type === 'articles' && dataA.sentiment && dataA.sentiment.models;
        var hasB = dataB.type === 'articles' && dataB.sentiment && dataB.sentiment.models;
        if (!hasA && !hasB) return null;

        var sentimentModels = modelKeys(hasA ? dataA : null, hasB ? dataB : null);
        if (!sentimentModels.length) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('AI sentiment comparison')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('Distribution of polarity and centrality in articles of each corpus, as rated by the AI models. The picker swaps the model; publications are not rated.')));

        // Toolbar — axis + model picker
        var toolbar = P.el('div', 'iwac-vis-compare-sentiment__toolbar');
        // Shared selects: the `.iwac-vis-control` skin, label wiring and a
        // stable `data-iwac-control` handle. These two were the last selects
        // in the module rendering as the browser's default (S19).
        var axisSelect = CN.buildSelect({
            label: P.t('Axis'),
            name: 'cmp-sent-axis',
            idPrefix: 'iwac-cmp-sent-axis-',
            options: [
                { value: 'polarite',     label: P.t('Polarity') },
                { value: 'centralite',   label: P.t('Centrality') },
                { value: 'subjectivite', label: P.t('Subjectivity') }
            ],
            onChange: rerenderAll
        });
        var modelSelect = CN.buildSelect({
            label: P.t('Model'),
            name: 'cmp-sent-model',
            idPrefix: 'iwac-cmp-sent-model-',
            options: sentimentModels.map(function (key) {
                return { value: key, label: P.sentimentModelLabel(key) };
            }),
            onChange: rerenderAll
        });

        toolbar.appendChild(axisSelect);
        toolbar.appendChild(modelSelect);
        panel.appendChild(toolbar);

        var wrap = P.el('div', 'iwac-vis-compare-sentiment');
        panel.appendChild(wrap);

        // A side's colour is read each time its chart is painted, never
        // captured here: a theme swap repaints, and both corpus colours
        // differ between light and dark.
        function colorA() { return CN.compareColors().a; }
        function colorB() { return CN.compareColors().b; }

        function makeSide(side, data, color) {
            var col = P.el('div', 'iwac-vis-compare-sentiment__col');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-eyebrow iwac-vis-compare-sentiment__heading', data.name));
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
            var axis = axisSelect.control.value;     // polarite | centralite
            var model = modelSelect.control.value;   // one of SENTIMENT_MODELS[].key
            var entries = (((data.sentiment || {}).models || {})[model] || {})[axis] || [];
            if (!entries.length) {
                instance.setOption(P.emptyChartOption('Not rated'), true);
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
                    itemStyle: { color: color(), borderRadius: [0, 4, 4, 0] },
                    label: { show: true, position: 'right',
                             formatter: function (p) { return P.formatNumber(p.value); } },
                    data: entries.map(function (e) { return e.count; })
                }],
                animationDuration: 500
            }, true);
        }

        var sides = [];
        if (hasA) sides.push(makeSide('A', dataA, colorA));
        else {
            var placeA = P.el('div', 'iwac-vis-compare-sentiment__col');
            placeA.dataset.side = 'A';
            placeA.appendChild(P.el('div', 'iwac-vis-eyebrow iwac-vis-compare-sentiment__heading', dataA.name));
            placeA.appendChild(P.buildEmptyState('Sentiment only on articles'));
            wrap.appendChild(placeA);
        }
        if (hasB) sides.push(makeSide('B', dataB, colorB));
        else {
            var placeB = P.el('div', 'iwac-vis-compare-sentiment__col');
            placeB.dataset.side = 'B';
            placeB.appendChild(P.el('div', 'iwac-vis-eyebrow iwac-vis-compare-sentiment__heading', dataB.name));
            placeB.appendChild(P.buildEmptyState('Sentiment only on articles'));
            wrap.appendChild(placeB);
        }

        function rerenderAll() {
            sides.forEach(function (s) {
                var live = ns.getLiveChart ? ns.getLiveChart(s.host) : s.chart;
                if (live) renderSentiment(live, s.data, s.color);
            });
        }

        return panel;
    }

    CN.buildSentiment = buildSentiment;
})();
