/**
 * Collection Introduction — orchestrator.
 *
 * The block arrives readable: the server renders its whole prose reading
 * (view/common/block-layout/collection-intro.phtml). This waits for the block
 * to near the viewport, fetches the Collection Overview's data — the same
 * `collection-overview.json` that block reads — and the six countries'
 * outlines, and hands all three to the Svelte introduction, which the same
 * bundle defines first (asset/js/svelte/collection-intro/index.js).
 *
 * The geometry is optional: without it the "Where" chapter keeps its ledger
 * and loses only the map. Without the data nothing is drawn, and the prose
 * reading stays: the block names no figure it cannot show.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    var P = ns.panels;
    var GEO = '/modules/IwacVisualizations/asset/geo/iwac-countries.geojson';

    P.bootBlock({
        selector: '.iwac-vis-intro',
        requireECharts: false,
        clearOnError: false,
        warnLabel: 'IWACVis collection introduction',
        load: function (ctx) {
            return Promise.all([
                P.fetchJSON(ctx.dataBase + 'collection-overview.json', { timeoutMs: P.FETCH_TIMEOUT_MS }),
                P.fetchOptionalJSON(ctx.basePath + GEO)
            ]);
        },
        onError: function (root, err) { console.error('IWACVis collection introduction:', err); },
        render: function (root, loaded, ctx) {
            ns.mountCollectionIntro(root, {
                data: loaded[0],
                geo: loaded[1],
                siteBase: ctx.siteBase,
                format: {
                    number: P.formatNumber,
                    percent: P.formatPercent,
                    date: P.formatDate,
                    t: P.t,
                    entityType: P.entityTypeLabel,
                    itemUrl: P.itemUrl
                }
            });
        }
    });
}());
