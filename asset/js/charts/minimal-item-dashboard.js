/**
 * IWAC Visualizations — Minimal item dashboard (orchestrator)
 *
 * Drives the per-item "context" view for resource templates that
 * don't have their own dedicated dashboard yet:
 *
 *   * 9  Audio            → audiovisual subset
 *   * 19 Video recording  → audiovisual subset
 *   * 22 Document         → documents subset
 *   * 15 Photograph       → images subset
 *
 * Loads ``asset/data/template-summary.json``, picks the slice for the
 * container's ``data-subset`` attribute, and dispatches two declarative
 * slots through the v0.16.0 dashboardLayout system:
 *
 *   1. ``siblingSparkline`` — year histogram for the whole subset,
 *      with a dot at the current item's year (pulled from
 *      ``data-pub-year``).
 *   2. ``similarItems``     — the slice's ``similar_by_id`` neighbours
 *      for this item when the subset carries an embedding (photographs:
 *      multimodal ``embedding_image`` cosine), else the most-recent N
 *      items in the subset excluding the current one (filtered by
 *      ``data-item-id``).
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

    // Layout is a function, not a static array: the strip's copy has to
    // tell the truth about what produced the cards. Recency ("other
    // items in this collection") and multimodal cosine similarity
    // ("visually similar photographs") are different claims, and a
    // reader can't tell them apart from the cards alone.
    DL.register('minimalItem', function (data) {
        var semantic = !!(data && data.semantic);
        return [
            { chart: 'siblingSparkline', wide: true,
              dataKey: 'sparkline',
              title: 'Activity over time',
              description: 'desc_minimal_sparkline' },
            { chart: 'similarItems',     wide: true,
              dataKey: 'similar',
              title: semantic
                  ? 'Visually similar photographs'
                  : 'Other items in this collection',
              description: semantic
                  ? 'desc_minimal_similar_semantic'
                  : 'desc_minimal_similar',
              // The recency list has no similarity score; the renderer's
              // normalize pass omits the badge when absent. Either way
              // drop the lowSignal threshold to 0 — filtering neighbours
              // by score would silently empty the strip on a corpus this
              // small (30 photographs).
              options: { max: 8, lowSignal: 0 } }
        ];
    });

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

        var url = basePath + P.DATA_BASE + 'template-summary.json';

        P.fetchJSON(url)
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

                // Similar items — prefer the precomputed neighbours for
                // this exact item when the subset has an embedding
                // (images: multimodal cosine over embedding_image).
                // Otherwise fall back to the recency list, dropping the
                // current item so users don't see "this same item
                // you're viewing" among the cards. The similar-items
                // renderer normalises the shape: title / o_id / date /
                // country / publisher / thumbnail / score are all
                // consumed natively.
                var neighbours = (slice.similar_by_id || {})[String(itemId)];
                var semantic   = !!(neighbours && neighbours.length);
                var similar    = semantic
                    ? neighbours
                    : (slice.top_items || []).filter(function (it) {
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
                    similar:   similar,
                    semantic:  semantic
                }, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis minimal-item dashboard:', err);
                var loading = container.querySelector('.iwac-vis-minimal-item__loading');
                if (loading) loading.remove();
                container.appendChild(P.buildFetchErrorState(err));
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
