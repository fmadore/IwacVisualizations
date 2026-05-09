/**
 * IWAC Visualizations — Minimal item dashboard (orchestrator)
 *
 * Drives the per-item "context" view for resource templates that
 * don't have their own dedicated dashboard yet:
 *
 *   * 9  Audio            → audiovisual subset
 *   * 19 Video recording  → audiovisual subset
 *   * 15 Photograph       → documents subset
 *
 * Loads ``asset/data/template-summary.json``, picks the slice for the
 * container's ``data-subset`` attribute, and dispatches two declarative
 * slots through the v0.16.0 dashboardLayout system:
 *
 *   1. ``siblingSparkline`` — year histogram for the whole subset,
 *      with a dot at the current item's year (pulled from
 *      ``data-pub-year``).
 *   2. ``similarItems``     — most-recent N items in the subset
 *      excluding the current one (filtered by ``data-item-id``).
 *
 * Both renderers come from the v0.16.0 shared/renderers/ collection;
 * no custom renderer registrations are needed here — the orchestrator
 * is purely composition.
 *
 * Dependencies: chart-options (for fallback option builders, even
 * though the two renderers don't strictly need it), dashboard-layout,
 * sibling-sparkline + similar-items renderers (declared via the
 * partial's ``$needs['renderers']``).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.dashboardLayout) {
        console.warn('IWACVis minimal-item dashboard: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Layout — two slots, both wide                                     */
    /* ----------------------------------------------------------------- */

    DL.register('minimalItem', [
        { chart: 'siblingSparkline', wide: true,
          dataKey: 'sparkline',
          title: 'Activity over time',
          description: 'desc_minimal_sparkline' },
        { chart: 'similarItems',     wide: true,
          dataKey: 'similar',
          title: 'Other items in this collection',
          description: 'desc_minimal_similar',
          // Items in template-summary.json have no similarity score
          // (this isn't semantic-kNN data); the renderer's normalize
          // pass handles missing scores by omitting the badge. Drop
          // the lowSignal threshold to 0 so nothing is filtered.
          options: { max: 8, lowSignal: 0 } }
    ]);

    /* ----------------------------------------------------------------- */
    /*  Bootstrap                                                         */
    /* ----------------------------------------------------------------- */

    function initDashboard(container) {
        var subset   = container.dataset.subset || '';
        var basePath = container.dataset.basePath || '';
        var itemId   = Number(container.dataset.itemId);
        var pubYear  = parseInt(container.dataset.pubYear, 10);
        if (isNaN(pubYear)) pubYear = null;

        // No template-id → subset map = nothing to render. Drop the
        // loading spinner so the block doesn't sit there forever.
        if (!subset) {
            var loading = container.querySelector('.iwac-vis-minimal-item__loading');
            if (loading) loading.remove();
            return;
        }

        var url = basePath + '/modules/IwacVisualizations/asset/data/template-summary.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (bundle) {
                var loading = container.querySelector('.iwac-vis-minimal-item__loading');
                if (loading) loading.remove();

                var slice = (bundle.subsets || {})[subset];
                if (!slice) {
                    container.appendChild(P.buildEmptyState());
                    return;
                }

                // Sparkline — siblingSparkline expects parallel
                // `years` + `values` arrays plus an optional
                // `highlight` year to stamp a dot at. Caption text
                // displays beneath the curve.
                var years  = (slice.years || []).map(function (e) { return e.year; });
                var values = (slice.years || []).map(function (e) { return e.count; });
                var sparkline = {
                    years:     years,
                    values:    values,
                    highlight: pubYear,
                    caption:   P.t('items_count', { count: P.formatNumber(slice.total || 0) })
                };

                // Similar items — drop the current item from the list
                // so users don't see "this same item you're viewing"
                // among the cards. The similar-items renderer
                // normalises the shape: title / o_id / date / country
                // / publisher / thumbnail are all consumed natively.
                var similar = (slice.top_items || []).filter(function (it) {
                    return it && it.o_id !== itemId;
                });

                var body = P.el('div', 'iwac-vis-minimal-item__body');
                container.appendChild(body);

                var ctx = {
                    siteBase: container.dataset.siteBase || '',
                    basePath: basePath,
                    data:     bundle
                };

                DL.render(body, 'minimalItem', {
                    sparkline: sparkline,
                    similar:   similar
                }, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis minimal-item dashboard:', err);
                var loading = container.querySelector('.iwac-vis-minimal-item__loading');
                if (loading) loading.remove();
                container.appendChild(P.buildErrorState());
            });
    }

    function init() {
        var containers = document.querySelectorAll('.iwac-vis-minimal-item');
        for (var i = 0; i < containers.length; i++) {
            initDashboard(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
