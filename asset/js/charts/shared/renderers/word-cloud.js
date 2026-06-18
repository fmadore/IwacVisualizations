/**
 * IWAC Visualizations — Word cloud renderer
 *
 * Layout-system wrapper around `IWACVis.chartOptions.wordcloud`. Renders
 * a precomputed `[word, count]` frequency list as an ECharts word cloud
 * (echarts-wordcloud extension), falling back to a horizontal bar chart
 * when the extension failed to load — both behaviours live in
 * `C.wordcloud`, so this renderer just feeds it the pairs.
 *
 * Used by the per-issue publication dashboard ("most frequent words in
 * this issue"). The frequency list is computed server-side by
 * scripts/generate_publication_dashboards.py from the issue's lemmas
 * (or OCR), so the browser never tokenizes raw text.
 *
 * Data shape (either form):
 *
 *     [['islam', 42], ['mosquée', 31], ...]   // bare pairs (canonical)
 *     { data: [['islam', 42], ...] }          // wrapped
 *
 * Registered as `wordCloud`. Predicate: ≥ 3 word/count pairs.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.word-cloud: dashboard-layout.js + panels.js must load first');
        return;
    }

    /** Coerce either a bare pairs array or a `{ data: [...] }` wrapper
     *  into the `[[word, count], ...]` list `C.wordcloud` consumes. */
    function toPairs(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.data)) return data.data;
        return [];
    }

    DL.registerRenderer('wordCloud', function (el, data) {
        if (!ns.chartOptions || typeof ns.chartOptions.wordcloud !== 'function') {
            console.warn('IWACVis.word-cloud renderer: chart-options-special.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var pairs = toPairs(data);
        if (!pairs.length) {
            el.appendChild(P.buildEmptyState());
            return;
        }
        // Clouds need vertical room — opt into the taller host floor.
        el.classList.add('iwac-vis-wordcloud-host');
        var option = ns.chartOptions.wordcloud(pairs);
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('wordCloud', {
        labelKey: 'Word cloud',
        descKey:  'desc_word_cloud',
        hasData:  function (v) {
            if (Array.isArray(v)) return v.length >= 3;
            return !!(v && Array.isArray(v.data) && v.data.length >= 3);
        }
    });
})();
