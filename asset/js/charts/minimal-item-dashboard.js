/**
 * IWAC Visualizations — Minimal item dashboard (orchestrator)
 *
 * Drives the per-item "context" view for resource templates that
 * don't have their own dedicated dashboard yet:
 *
 *   * 9  Audio            → audiovisual subset
 *   * 19 Video recording  → audiovisual subset
 *   * 23 YouTube video    → audiovisual subset
 *   * 22 Document         → documents subset
 *   * 15 Photograph       → images subset
 *
 * Loads ``asset/data/template-summary.json``, picks the slice for the
 * container's ``data-subset`` attribute, and dispatches two declarative
 * slots through the v0.16.0 dashboardLayout system:
 *
 *   1. ``siblingSparkline`` — year histogram for the slice, with a dot
 *      at the current item's year (pulled from ``data-pub-year``).
 *   2. ``similarItems``     — the slice's ``similar_by_id`` neighbours
 *      for this item when the subset carries an embedding (photographs:
 *      multimodal ``embedding_image`` cosine), else the most-recent N
 *      items in the slice excluding the current one (filtered by
 *      ``data-item-id``).
 *
 * Audiovisual items additionally narrow BOTH slots to the item's own
 * publisher — its YouTube channel, or the body that deposited the
 * recording — via the bundle's ``by_publisher`` slices, and lead with a
 * row of figures for that channel plus a link to the canonical watch
 * URL. Scoping is best-effort by design: a publisher with no slice
 * (a fresh channel, a bundle generated before the split existed, an
 * item with no publisher at all) silently falls back to the whole
 * subset rather than emptying the block. Class 38 is the data
 * boundary — the template only decides the presentation.
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

    // Layout is a function, not a static array: the panel copy has to
    // tell the truth about what produced its content. "Every video this
    // channel has posted", "other items in this collection" and
    // multimodal cosine similarity are three different claims, and a
    // reader cannot tell them apart from the cards alone.
    DL.register('minimalItem', function (data) {
        var semantic = !!(data && data.semantic);
        var scoped   = !!(data && data.scope);
        return [
            { chart: 'siblingSparkline', wide: true,
              dataKey: 'sparkline',
              title: scoped ? 'Activity of this source over time' : 'Activity over time',
              description: scoped ? 'desc_minimal_sparkline_scoped' : 'desc_minimal_sparkline' },
            { chart: 'similarItems',     wide: true,
              dataKey: 'similar',
              title: semantic
                  ? 'Visually similar photographs'
                  : (scoped ? 'More from this source' : 'Other items in this collection'),
              description: semantic
                  ? 'desc_minimal_similar_semantic'
                  : (scoped ? 'desc_minimal_similar_scoped' : 'desc_minimal_similar'),
              // The recency list has no similarity score; the renderer's
              // normalize pass omits the badge when absent. Either way
              // drop the lowSignal threshold to 0 — filtering neighbours
              // by score would silently empty the strip on a corpus this
              // small (30 photographs).
              options: { max: 8, lowSignal: 0 } }
        ];
    });

    /* ----------------------------------------------------------------- */
    /*  Slice selection                                                   */
    /* ----------------------------------------------------------------- */

    /** Same normalisation the generator applies to its slice keys, so
     *  the PHP side can hand over a raw display title and neither end
     *  has to reproduce the other's folding rules. */
    function sliceKey(value) {
        var s = String(value == null ? '' : value).trim();
        return (s.normalize ? s.normalize('NFC') : s).toLowerCase();
    }

    /**
     * Narrow a subset slice to the current item's publisher.
     *
     * Returns the whole subset unchanged whenever that is not possible,
     * which is the case that keeps this working across a data refresh:
     * `by_publisher` only exists in bundles generated after the
     * source-aware precompute landed.
     */
    function scopeToPublisher(subsetSlice, channel) {
        var groups = subsetSlice && subsetSlice.by_publisher;
        var key = sliceKey(channel);
        if (!groups || !key) return null;

        if (Object.prototype.hasOwnProperty.call(groups, key)) return groups[key];

        // The publisher recorded on the item may differ from the dataset's
        // spelling by accents or case beyond what NFC folding covers.
        // Fall back to matching the display label the slice carries.
        var keys = Object.keys(groups);
        for (var i = 0; i < keys.length; i++) {
            if (sliceKey(groups[keys[i]].label) === key) return groups[keys[i]];
        }
        return null;
    }

    /* ----------------------------------------------------------------- */
    /*  Channel figures                                                   */
    /* ----------------------------------------------------------------- */

    /**
     * Summary-card row for an audiovisual slice: how many items, how
     * much material, and how long a typical one runs.
     *
     * Total and median are both shown because on this corpus they
     * disagree usefully — a channel of three-minute news clips and a
     * shelf of multi-hour sermon DVDs can reach the same total.
     */
    function buildFigures(slice) {
        var duration = slice.duration || {};
        // Name the things being counted where the data says what they
        // are. A channel slice is videos; a mixed subset is items, and
        // calling those "videos" would quietly annex the deposited
        // audio recordings.
        var cards = [
            { value: slice.total || 0,
              labelKey: slice.source_type === 'youtube' ? 'Videos' : 'Items' }
        ];

        if (duration.total_seconds > 0) {
            var hours = duration.total_seconds / 3600;
            cards.push({
                value: hours >= 1
                    ? P.t('hours_count', { count: P.formatNumber(Math.round(hours)) })
                    : P.t('minutes_count', { count: P.formatNumber(Math.round(duration.total_seconds / 60)) }),
                labelKey: 'Total runtime',
                text: true
            });
        }
        if (duration.median_seconds > 0) {
            cards.push({
                value: P.formatDuration(duration.median_seconds),
                labelKey: 'Median length',
                text: true
            });
        }
        return P.buildSummaryCards(cards);
    }

    /**
     * "Watch on YouTube" link for the current item. The URL is
     * validated server-side (https + a YouTube host) before it reaches
     * the data attribute, so this only decides whether to render it.
     * Deliberately a link and never an embed: an iframe would fire
     * third-party requests on page load for every visitor, whether or
     * not they intend to watch.
     */
    function buildWatchLink(url) {
        var link = P.el('a', 'iwac-vis-minimal-item__watch', P.t('Watch on YouTube'));
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
    }

    /* ----------------------------------------------------------------- */
    /*  Bootstrap                                                         */
    /* ----------------------------------------------------------------- */

    /**
     * Which slice of the template summary this item reads — the whole
     * subset, or one channel of it — resolved once per container and
     * memoised on ctx because both the header and the grid need it.
     */
    function resolveScope(bundle, ctx) {
        if (ctx._scope !== undefined) return ctx._scope;
        var ds = ctx.container.dataset;
        var subsetSlice = (bundle.subsets || {})[ds.subset || ''];
        if (!subsetSlice) {
            ctx._scope = null;
            return null;
        }
        var channel = ds.channel || '';
        var scope = scopeToPublisher(subsetSlice, channel);
        ctx._scope = {
            subsetSlice: subsetSlice,
            scope:       scope,
            slice:       scope || subsetSlice,
            channel:     channel
        };
        return ctx._scope;
    }

    // The shared per-item boot (fetch with a bounded wait, spinner → body,
    // retry banner) replaced the hand-rolled scaffold this file carried until
    // v1.59.0. This block reads one shared bundle rather than a per-item
    // file, and scopes it here.
    P.bootPerItemDashboard({
        selector:   '.iwac-vis-minimal-item',
        classToken: 'minimal-item',
        dataFile:   'template-summary.json',
        layout:     'minimalItem',
        warnLabel:  'IWACVis minimal-item dashboard',
        // Sparkline (inline SVG) + cards: no ECharts renderer in this layout.
        requireECharts: false,
        // No template-id → subset map = nothing to render. Drop the loading
        // spinner rather than fetch a bundle nothing will read.
        skip: function (container) { return !container.dataset.subset; },
        slices: function (bundle, ctx) {
            var scoped = resolveScope(bundle, ctx);
            if (!scoped) return null;
            var slice = scoped.slice;
            var ds = ctx.container.dataset;
            var itemId = Number(ds.itemId);
            var pubYear = parseInt(ds.pubYear, 10);
            if (isNaN(pubYear)) pubYear = null;

            // Sparkline — siblingSparkline expects parallel `years` +
            // `values` arrays plus an optional `highlight` year to stamp a
            // dot at. Caption text displays beneath the curve.
            var years  = (slice.years || []).map(function (e) { return e.year; });
            var values = (slice.years || []).map(function (e) { return e.count; });
            var sparkline = {
                years:     years,
                values:    values,
                highlight: pubYear,
                caption:   scoped.scope
                    ? P.t('items_from_source', {
                        count: P.formatNumber(slice.total || 0),
                        source: slice.label || scoped.channel
                    })
                    : P.t('items_count', { count: P.formatNumber(slice.total || 0) })
            };

            // Similar items — prefer the precomputed neighbours for this
            // exact item when the subset has an embedding (images:
            // multimodal cosine over embedding_image). Neighbours are
            // computed over the whole subset, so they are read from there
            // rather than from the scoped slice. Otherwise fall back to the
            // recency list, dropping the current item so users don't see
            // "this same item you're viewing" among the cards. The
            // similar-items renderer normalises the shape: title / o_id /
            // date / country / publisher / duration / thumbnail / score are
            // all consumed natively.
            var neighbours = (scoped.subsetSlice.similar_by_id || {})[String(itemId)];
            var semantic   = !!(neighbours && neighbours.length);
            var similar    = semantic
                ? neighbours
                : (slice.top_items || []).filter(function (it) {
                    return it && it.o_id !== itemId;
                });

            return {
                sparkline: sparkline,
                similar:   similar,
                semantic:  semantic,
                scope:     !!scoped.scope
            };
        },
        mountHeader: function (body, bundle, ctx) {
            var scoped = resolveScope(bundle, ctx);
            if (!scoped) return;
            // Figures + watch link ride above the panel grid, as direct
            // children of the block (minimal-item.css addresses the figure
            // row as `.iwac-vis-minimal-item > .iwac-vis-overview-summary`),
            // so they go BEFORE the body rather than into it. Only
            // audiovisual slices carry a runtime, so the row simply doesn't
            // appear for documents or photographs.
            var container = ctx.container;
            if (scoped.slice.duration) {
                container.insertBefore(buildFigures(scoped.slice), body);
            }
            var watchUrl = container.dataset.watchUrl || '';
            if (watchUrl) {
                var actions = P.el('p', 'iwac-vis-minimal-item__actions');
                actions.appendChild(buildWatchLink(watchUrl));
                container.insertBefore(actions, body);
            }
        }
    });

    // Exported for tests — the scoping rules are where this block either
    // shows a channel or silently falls back, and that is worth pinning
    // down without a browser. Same shape as person-dashboard/network.js.
    ns.minimalItem = { sliceKey: sliceKey, scopeToPublisher: scopeToPublisher };
})();
