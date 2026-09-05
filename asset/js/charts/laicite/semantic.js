/**
 * IWAC Visualizations — Laïcité block: semantic map (issue #19 C).
 *
 * UMAP scatter of the dossier's press half, coloured by argumentative
 * frame, country or decade.
 *
 * Two jobs at once. It is a discovery view — discourse clusters that cut
 * across the hand-crafted frames — and it is a robustness check on the
 * frame taxonomy itself. If the embedding clusters do not roughly
 * recover the curated frames, that is worth knowing *before* anyone
 * publishes the arena counts, which is why the panel leads with that
 * reading rather than presenting itself as decoration.
 *
 * COVERAGE IS PART OF THE CHART, not a footnote. The projection is
 * `articles` only: publications carry a table-of-contents vector rather
 * than a text one, documents carry none, and references are scholarship
 * about the sources rather than sources. Co-projecting a contents page
 * with an article body would place a periodical by its index and quietly
 * break this block's rule that nothing sums across subsets unlabelled.
 * So the caption states which corpora are on the map and how many items
 * carry a vector, every time.
 *
 * The generator ships an empty-state contract (same keys, no points) when
 * umap-learn is missing or too few items are embedded, so the panel
 * explains which rather than showing a bare "no data" box.
 *
 * Coordinates are NOT comparable with the Semantic Landscape block's:
 * separate projections of different point sets.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.laicite semantic: missing panels or chartOptions — check load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;
    var L = ns.laicite = ns.laicite || {};

    var FACETS = ['frame', 'country', 'decade'];
    var FACET_LABEL_KEY = {
        frame:   'laicite.semantic_by_frame',
        country: 'laicite.semantic_by_country',
        decade:  'laicite.semantic_by_decade'
    };

    function hasPoints(bundle) {
        return !!(bundle && bundle.points && bundle.points.o_id
                  && bundle.points.o_id.length);
    }

    function tableFor(bundle, facet) {
        if (facet === 'frame')   return bundle.frames || [];
        if (facet === 'country') return bundle.countries || [];
        return bundle.decades || [];
    }

    /** Which facets the bundle can actually distinguish points by. */
    function availableFacets(bundle) {
        return FACETS.filter(function (f) {
            return tableFor(bundle, f).length > 1;
        });
    }

    /**
     * Bucket point indices by the active facet's category.
     *
     * A point with no category (-1) lands in an explicit bucket rather
     * than vanishing. For `frame` that bucket is load-bearing rather than
     * tidy-up: it is the items that matched a membership frame and no
     * annotation frame at all — the coverage that says laïcité without
     * attaching to school, public space, family law or any other arena.
     * Dropping them would shrink the map on a facet change and hide the
     * one group whose absence from the taxonomy is itself a result.
     */
    function groupsFor(bundle, facet, frameLabel) {
        var pts = bundle.points;
        var table = tableFor(bundle, facet);
        var column = pts[facet] || [];
        var unclassified = facet === 'frame'
            ? P.t('laicite.semantic_unframed')
            : P.t('Other');

        var groups = {};
        var order = [];
        for (var i = 0; i < pts.o_id.length; i++) {
            var idx = column[i];
            var name = (idx >= 0 && table[idx] != null) ? table[idx] : unclassified;
            if (facet === 'frame' && idx >= 0) name = frameLabel(name);
            if (!groups[name]) { groups[name] = []; order.push(name); }
            groups[name].push(i);
        }
        if (facet === 'decade') order.sort();
        else order.sort(function (a, b) { return groups[b].length - groups[a].length; });
        var tail = order.indexOf(unclassified);
        if (tail !== -1) order.splice(order.length - 1, 0, order.splice(tail, 1)[0]);
        return { groups: groups, order: order };
    }

    function option(bundle, facet, frameLabel, frameColors) {
        var pts = bundle.points;
        var frames = bundle.frames || [];

        return C.landscape(pts, groupsFor(bundle, facet, frameLabel), {
            symbolSize: 6,
            opacity: 0.7,
            tooltipBits: function (i) {
                var bits = [];
                var f = pts.frame ? pts.frame[i] : -1;
                if (f >= 0 && frames[f]) bits.push(frameLabel(frames[f]));
                if (pts.year && pts.year[i]) bits.push(String(pts.year[i]));
                return bits;
            },
            // On the frame facet, reuse the block's own frame palette so a
            // cluster here and a band in the arenas view are the same
            // colour rather than two unrelated encodings of one category.
            seriesColor: facet === 'frame' && frameColors
                ? function (name) {
                    var key = frameKeyFor(frames, frameLabel, name);
                    return key && frameColors[key] ? frameColors[key] : null;
                }
                : null
        });
    }

    /** Reverse the display label back to its frame key, for the palette. */
    function frameKeyFor(frames, frameLabel, label) {
        for (var i = 0; i < frames.length; i++) {
            if (frameLabel(frames[i]) === label) return frames[i];
        }
        return '';
    }

    /**
     * @param {Object} cfg {bundle, metadata, state, frameColors, siteBase}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildSemantic = function (cfg) {
        var bundle = cfg.bundle;
        var metadata = cfg.metadata || {};
        var root = P.el('div', 'iwac-vis-laicite-semantic');
        var meta = (bundle && bundle.meta) || {};

        var panel = P.buildPanel('iwac-vis-panel iwac-vis-laicite-semantic-panel',
            P.t('laicite.semantic_title'), P.t('laicite.semantic_desc'));

        // The coverage line is not optional chrome: this map covers one
        // of the dossier's four corpora and must never read as all four.
        panel.panel.insertBefore(
            P.el('p', 'iwac-vis-panel-desc iwac-vis-laicite-semantic-coverage',
                P.t('laicite.semantic_coverage', {
                    embedded: P.formatNumber(meta.embedded || 0),
                    total: P.formatNumber(meta.total || 0)
                })),
            panel.chart);

        if (!hasPoints(bundle)) {
            var key = meta.reason === 'umap_not_installed'
                ? 'laicite.semantic_empty_umap'
                : (meta.reason === 'too_few_embeddings' || meta.reason === 'too_few_items')
                    ? 'laicite.semantic_empty_few'
                    : 'laicite.semantic_empty';
            panel.chart.appendChild(P.buildEmptyState(P.t(key)));
            root.appendChild(panel.panel);
            return { root: root, mount: function () {} };
        }

        function frameLabel(frame) {
            return L.frameLabel(metadata, frame);
        }

        var facets = availableFacets(bundle);
        if (!facets.length) facets = ['frame'];
        var active = facets.indexOf(cfg.state && cfg.state.semanticFacet) !== -1
            ? cfg.state.semanticFacet
            : facets[0];

        if (facets.length > 1 && P.buildFacetButtons) {
            var subFacets = {};
            facets.forEach(function (f) { subFacets[f] = P.t(FACET_LABEL_KEY[f]); });
            var bar = P.buildFacetButtons({
                facets: [{
                    key: 'facet',
                    label: P.t('Color by'),
                    subFacets: subFacets,
                    renderAs: 'buttons'
                }],
                activeKey: 'facet',
                onChange: function (evt) {
                    var f = evt.subFacet || facets[0];
                    if (facets.indexOf(f) === -1) f = facets[0];
                    active = f;
                    if (cfg.state) cfg.state.semanticFacet = f;
                    var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
                    // `true` — each facet is a different series set, so a
                    // merged update would leave the previous one behind.
                    if (live) {
                        live.setOption(
                            option(bundle, active, frameLabel, cfg.frameColors), true);
                    }
                }
            });
            panel.panel.insertBefore(bar.root, panel.chart);
        }

        root.appendChild(panel.panel);

        return {
            root: root,
            mount: function () {
                var chart = ns.registerChart(panel.chart, function (el, instance) {
                    instance.setOption(
                        option(bundle, active, frameLabel, cfg.frameColors), true);
                });
                P.navigateOnClick(chart, cfg.siteBase, function (params) {
                    var i = params.data && params.data[2];
                    return i == null ? null : bundle.points.o_id[i];
                });
            }
        };
    };
})();
