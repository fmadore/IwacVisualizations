/**
 * IWAC Visualizations — Collection Overview: Word cloud panel
 *
 * Lazy-loaded: waits for the panel to enter the viewport before
 * fetching `asset/data/collection-wordcloud.json`. Then renders a
 * faceted word cloud (Global / By country / By year) using C.wordcloud.
 * Falls back to a horizontal bar chart if echarts-wordcloud failed to
 * load from the CDN.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/wordcloud: missing dependencies');
        return;
    }

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/collection-wordcloud.json';

        var loading = P.el('div', 'iwac-vis-loading');
        loading.appendChild(P.el('div', 'iwac-vis-spinner'));
        loading.appendChild(P.el('span', null, P.t('Loading')));
        panelEl.chart.appendChild(loading);

        var loaded = false;

        function loadAndRender() {
            if (loaded) return;
            loaded = true;

            fetch(url)
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (wc) {
                    panelEl.chart.innerHTML = '';
                    build(panelEl, wc);
                })
                .catch(function (err) {
                    console.error('IWACVis wordcloud:', err);
                    panelEl.chart.innerHTML = '';
                    panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
                });
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        loadAndRender();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            loadAndRender();
        }
    }

    function build(panelEl, wc) {
        var state = { facet: 'global', subFacet: null };

        var countries = Object.keys(wc.by_country || {}).sort();
        var countrySub = countries.reduce(function (acc, c) { acc[c] = c; return acc; }, {});

        var years = Object.keys(wc.by_year || {}).sort();
        var yearSub = years.reduce(function (acc, y) { acc[y] = y; return acc; }, {});

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'global',     label: P.t('Global') },
                { key: 'by_country', label: P.t('By country'), subFacets: countrySub, renderAs: 'select' },
                { key: 'by_year',    label: P.t('By year'),    subFacets: yearSub,    renderAs: 'select' }
            ],
            activeKey: 'global',
            onChange: function (evt) {
                state.facet = evt.facet;
                state.subFacet = evt.subFacet || null;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var meta = P.el('div', 'iwac-vis-wordcloud-meta');
        meta.style.marginTop = '0.5rem';
        meta.style.fontSize = '0.85rem';
        meta.style.color = 'var(--ink-muted, #666)';
        panelEl.panel.appendChild(meta);

        function currentFacetData() {
            if (state.facet === 'global')     return wc.global || { data: [], total_articles: 0, unique_words: 0 };
            if (state.facet === 'by_country') return (wc.by_country || {})[state.subFacet] || { data: [], total_articles: 0, unique_words: 0 };
            if (state.facet === 'by_year')    return (wc.by_year || {})[state.subFacet] || { data: [], total_articles: 0, unique_words: 0 };
            return { data: [], total_articles: 0, unique_words: 0 };
        }

        function updateMeta(fd) {
            var articles = P.formatNumber(fd.total_articles || 0);
            var unique = P.formatNumber(fd.unique_words || 0);
            meta.textContent = articles + ' articles \u00b7 ' + unique + ' ' + P.t('unique words');
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var fd = currentFacetData();
            instance.setOption(C.wordcloud(fd.data || []), true);
            updateMeta(fd);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var fd = currentFacetData();
                chart.setOption(C.wordcloud(fd.data || []), true);
                updateMeta(fd);
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.wordcloud = { render: render };
})();
