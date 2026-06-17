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
        axisLabel.htmlFor = 'iwac-cmp-sent-axis-' + CN.nextUid();
        var axisSelect = P.el('select');
        axisSelect.id = axisLabel.htmlFor;
        [
            { key: 'polarite',     label: P.t('Polarity') },
            { key: 'centralite',   label: P.t('Centrality') },
            { key: 'subjectivite', label: P.t('Subjectivity') }
        ].forEach(function (o) {
            var opt = P.el('option', null, o.label);
            opt.value = o.key;
            axisSelect.appendChild(opt);
        });

        var modelLabel = P.el('label', null, P.t('Model'));
        modelLabel.htmlFor = 'iwac-cmp-sent-model-' + CN.nextUid();
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

        var _cc = CN.compareColors();
        var colorA = _cc.a;
        var colorB = _cc.b;

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
            placeA.appendChild(P.buildEmptyState('Sentiment only on articles'));
            wrap.appendChild(placeA);
        }
        if (hasB) sides.push(makeSide('B', dataB, colorB));
        else {
            var placeB = P.el('div', 'iwac-vis-compare-sentiment__col');
            placeB.dataset.side = 'B';
            placeB.appendChild(P.el('div', 'iwac-vis-compare-sentiment__heading', dataB.name));
            placeB.appendChild(P.buildEmptyState('Sentiment only on articles'));
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

    CN.buildSentiment = buildSentiment;
})();
