/**
 * IWAC Visualizations — Scary Terms block: Word cloud view builders (issue #4).
 *
 * Stateless helpers for the vocabulary view: slice selection over the
 * precomputed scary-terms-wordcloud.json (global / by family / by
 * country / by 5-year period) and the `<details>` word-list fallback.
 * The pixels come from the shared C.wordcloud builder (echarts-wordcloud
 * with the horizontal-bar fallback) — no forked cloud implementation.
 *
 * Loaded after scary-terms/helpers.js, before the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms wordcloud: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    /**
     * Resolve the active slice of the wordcloud bundle.
     *
     * @param {Object} wc     parsed scary-terms-wordcloud.json
     * @param {string} facet  'global' | 'by_family' | 'by_country' | 'by_year_bucket'
     * @param {?string} sub   sub-facet key (family / country / bucket)
     * @returns {{data: Array<[string, number]>, total_articles: number}}
     */
    S.wordcloudSlice = function (wc, facet, sub) {
        var empty = { data: [], total_articles: 0 };
        if (!wc) return empty;
        if (facet === 'global' || !facet) return wc.global || empty;
        var group = wc[facet] || {};
        return (sub && group[sub]) || empty;
    };

    /** Facet config consumed by P.buildFacetButtons for the controls row. */
    S.buildWordcloudFacets = function (wc) {
        function subMap(group) {
            return Object.keys(group || {}).sort().reduce(function (acc, k) {
                acc[k] = k;
                return acc;
            }, {});
        }
        var facets = [{ key: 'global', label: P.t('Global') }];
        if (wc.by_family && Object.keys(wc.by_family).length) {
            facets.push({
                key: 'by_family',
                label: P.t('scary.by_family'),
                subFacets: subMap(wc.by_family),
                renderAs: 'select'
            });
        }
        if (wc.by_country && Object.keys(wc.by_country).length) {
            facets.push({
                key: 'by_country',
                label: P.t('By country'),
                subFacets: subMap(wc.by_country),
                renderAs: 'select'
            });
        }
        if (wc.by_year_bucket && Object.keys(wc.by_year_bucket).length) {
            facets.push({
                key: 'by_year_bucket',
                label: P.t('scary.by_period'),
                subFacets: subMap(wc.by_year_bucket),
                renderAs: 'select'
            });
        }
        return facets;
    };

    /**
     * `<details>` word-list table mirroring the active slice — the
     * accessibility path for a chart type that is famously
     * screen-reader-hostile. Columns: word · article count · % of the
     * slice's matching articles.
     */
    S.buildWordListDetails = function (slice) {
        var pairs = (slice && slice.data) || [];
        if (!pairs.length) return null;
        var total = (slice && slice.total_articles) || 0;

        var details = P.el('details', 'iwac-vis-scary-details');
        details.appendChild(P.el('summary', null, P.t('scary.wordcloud_word_list')));

        var table = P.el('table', 'iwac-vis-scary-details-table');
        var thead = P.el('thead');
        var headRow = P.el('tr');
        headRow.appendChild(P.el('th', null, P.t('scary.word')));
        headRow.appendChild(P.el('th', null, P.t('scary.articles_col')));
        if (total > 0) headRow.appendChild(P.el('th', null, '%'));
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = P.el('tbody');
        pairs.forEach(function (pair) {
            var tr = P.el('tr');
            tr.appendChild(P.el('td', null, pair[0]));
            tr.appendChild(P.el('td', null, P.formatNumber(pair[1])));
            if (total > 0) {
                tr.appendChild(P.el('td', null,
                    Math.round((pair[1] / total) * 100) + '%'));
            }
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        details.appendChild(table);
        return details;
    };
})();
