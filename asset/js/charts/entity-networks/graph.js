/**
 * IWAC Visualizations — Entity Networks: MapLibre graph renderer
 *
 * Renders a node-link graph with MapLibre GL — the same WebGL renderer
 * every IWAC map already ships — instead of a dedicated graph library.
 * Positions are precomputed (ForceAtlas2 in Python for the abstract
 * entity graph, real coordinates for the geographic place network), so
 * the client does zero layout work and pan/zoom over ~10k edges stays
 * GPU-bound. Symbol layers give label collision for free; popups,
 * download and light/dark theming ride the existing IWAC map
 * infrastructure. Fullscreen does not: the orchestrator expands the whole
 * block layout from one toggle, so neither map carries MapLibre's own.
 *
 * Two modes:
 *   - 'abstract' — blank canvas style (P.buildGraphStyle), node color
 *     by entity type, through the theme's `--type-entity-*` tokens every
 *     IWAC entity graph reads (`ns.getEntityTypeColor`)
 *   - 'geo'      — regular theme basemap, nodes at true coordinates
 *
 * `create()` gates on `P.whenMaplibre()` and always returns a controller:
 * calls made while the library is still importing are replayed once it lands,
 * and the host shows the standard map spinner meanwhile.
 *
 * Usage:
 *   var graph = ns.entityNetworks.graph.create(container, {
 *       mode: 'abstract',
 *       onSelect: function (selection) { ... }   // null on deselect
 *   });
 *   graph.setData({ nodes, edges, weightMin });
 *   graph.setTypeFilter([0, 2]);    // abstract only
 *   graph.setWeightMin(5);
 *   graph.focusNode(12);
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.createIwacPopup || !P.deferMaplibre) {
        console.warn('IWACVis.entity-networks/graph: missing deps (need shared/maplibre.js + panels-map.js)');
        return;
    }

    var SRC_NODES = 'net-nodes';
    var SRC_EDGES = 'net-edges';
    var L_EDGES = 'net-edge-lines';
    var L_EDGES_HL = 'net-edge-lines-hl';
    var L_NODES = 'net-node-circles';
    var L_RING = 'net-node-ring';
    var L_HOVER_RING = 'net-node-hover-ring';
    var L_LABELS = 'net-node-labels';

    var MIN_RADIUS = 3;
    var MAX_RADIUS = 17;

    /**
     * The share of nodes trimmed from each end of each axis before the
     * opening view is fitted. A layout straggler used to set the frame for
     * everything: one node at the top edge, 2,852 packed into the bottom
     * 15% of the canvas (2026-11). The generator now eases stragglers into
     * a rim; this keeps an older payload, or a future straggler, from ever
     * taking the opening view again.
     */
    var FIT_QUANTILE = 0.01;
    /** Neighbours a selection's view is fitted to (the sidebar lists 15). */
    var FOCUS_FIT = 15;
    /**
     * Neighbours drawn at full strength — opaque, labelled, joined by a
     * highlighted line — while a node is selected. The rest of its
     * neighbours stay visible but muted: a hub such as "Hadj" has 1,300+
     * links, and lighting all of them lit half the map.
     */
    var FOCUS_LABELS = 30;
    /**
     * The edge count the overview's line opacity is tuned for. A denser
     * payload thins every line in proportion (`edgeDensity`), so doubling
     * the links does not turn the overview into a solid grey wall.
     */
    var EDGE_BUDGET = 50000;

    function quantile(sorted, q) {
        if (!sorted.length) return 0;
        var pos = q * (sorted.length - 1);
        var lo = Math.floor(pos);
        var hi = Math.min(lo + 1, sorted.length - 1);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }

    function ascending(a, b) { return a - b; }

    /**
     * [west, south, east, north] around the central share of `points`
     * ({lng, lat}), `q` trimmed from each end of each axis. Latitude is
     * monotonic in Mercator y, so a quantile of one is a quantile of the
     * other. Exported for the unit tests.
     */
    function coreBounds(points, q) {
        var lngs = points.map(function (n) { return n.lng; }).sort(ascending);
        var lats = points.map(function (n) { return n.lat; }).sort(ascending);
        q = q || 0;
        return [quantile(lngs, q), quantile(lats, q), quantile(lngs, 1 - q), quantile(lats, 1 - q)];
    }

    function ml(c) {
        return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(c) : c;
    }

    function createOnMaplibre(container, opts) {
        opts = opts || {};
        var mode = opts.mode === 'geo' ? 'geo' : 'abstract';
        var onSelect = opts.onSelect || function () {};

        var data = null;          // { nodes, edges, weightMin }
        var adjacency = [];       // node index → [{ j, w }]
        var nodeFeatures = null;
        var edgeFeatures = null;
        var bounds = null;
        var fitted = false;
        var edgeDensity = 1;      // line-opacity factor for the payload's edge count

        var typeFilter = null;    // null = all types, else array of type indexes
        var weightMin = 0;
        var selectedIndex = null;
        var hoverIndex = null;    // a sidebar row the reader is pointing at

        var hover = null;         // P.attachMapHoverPopup's handle, once the map exists

        /* --------------------------------------------------------------- */
        /*  Colors — resolved at every (re)build so theme swaps flow in     */
        /* --------------------------------------------------------------- */

        // `getChartTokens()` fills every key from the theme's fallbacks, so
        // none of these needs a literal of its own.
        function colors() {
            var tokens = ns.getChartTokens();
            return {
                primary: ml(tokens.primary),
                ink: ml(tokens.ink),
                inkLight: ml(tokens.inkLight),
                muted: ml(tokens.muted),
                surface: ml(tokens.surface)
            };
        }

        /**
         * A node's colour by its entity type. The payload names its types in
         * its own order (`data.types`, Personnes · Organisations · Événements
         * · Sujets · Lieux), and colouring by that INDEX painted Lieux and
         * Événements differently here from every item-page network. The
         * index → type name → type token lookup makes them agree.
         */
        function nodeColorExpression(c) {
            if (mode === 'geo' || !data || !data.types) return c.primary;
            var expr = ['match', ['get', 'type']];
            data.types.forEach(function (type, idx) {
                expr.push(idx, ml(ns.getEntityTypeColor(type)));
            });
            expr.push(c.muted);
            return expr;
        }

        /* --------------------------------------------------------------- */
        /*  Feature building                                                */
        /* --------------------------------------------------------------- */

        function buildFeatures() {
            var maxCount = 1;
            var maxWeight = 1;
            data.nodes.forEach(function (n) { if (n.count > maxCount) maxCount = n.count; });
            data.edges.forEach(function (e) { if (e[2] > maxWeight) maxWeight = e[2]; });

            nodeFeatures = {
                type: 'FeatureCollection',
                features: data.nodes.map(function (n, i) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
                        properties: {
                            i: i,
                            type: n.type != null ? n.type : -1,
                            r: MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) *
                                Math.sqrt(n.count / maxCount),
                            label: n.label,
                            rank: n.rank != null ? n.rank : i
                        }
                    };
                })
            };

            edgeFeatures = {
                type: 'FeatureCollection',
                features: data.edges.map(function (e) {
                    var s = data.nodes[e[0]];
                    var t = data.nodes[e[1]];
                    return {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [[s.lng, s.lat], [t.lng, t.lat]]
                        },
                        properties: {
                            s: e[0],
                            t: e[1],
                            w: e[2],
                            st: s.type != null ? s.type : -1,
                            tt: t.type != null ? t.type : -1,
                            // Normalized weight drives opacity + width so
                            // paint expressions don't need the max baked in.
                            wn: Math.sqrt(e[2] / maxWeight)
                        }
                    };
                })
            };

            edgeDensity = Math.min(1, Math.sqrt(EDGE_BUDGET / Math.max(1, data.edges.length)));

            adjacency = data.nodes.map(function () { return []; });
            data.edges.forEach(function (e) {
                adjacency[e[0]].push({ j: e[1], w: e[2] });
                adjacency[e[1]].push({ j: e[0], w: e[2] });
            });
            adjacency.forEach(function (list) {
                list.sort(function (a, b) { return b.w - a.w; });
            });

            // The place network's bounds are real geography and stay whole;
            // the abstract layout is fitted to its core (FIT_QUANTILE).
            bounds = data.bounds ||
                coreBounds(data.nodes, mode === 'abstract' ? FIT_QUANTILE : 0);
        }

        /**
         * A node's neighbours as the reader currently filters the graph,
         * strongest first. The sidebar, the selection's view and the
         * neighbourhood graph all read this, so none of them lists a link
         * the map is hiding.
         */
        function visibleNeighbours(index) {
            return adjacency[index].filter(function (nb) {
                if (nb.w < weightMin) return false;
                return !typeFilter || typeFilter.indexOf(data.nodes[nb.j].type) !== -1;
            });
        }

        /* --------------------------------------------------------------- */
        /*  Filters                                                         */
        /* --------------------------------------------------------------- */

        function nodeFilter() {
            if (!typeFilter) return null;
            return ['in', ['get', 'type'], ['literal', typeFilter]];
        }

        function edgeFilter() {
            var parts = [];
            if (weightMin > (data ? data.weightMin : 0)) {
                parts.push(['>=', ['get', 'w'], weightMin]);
            }
            if (typeFilter) {
                parts.push(['in', ['get', 'st'], ['literal', typeFilter]]);
                parts.push(['in', ['get', 'tt'], ['literal', typeFilter]]);
            }
            if (!parts.length) return null;
            return parts.length === 1 ? parts[0] : ['all'].concat(parts);
        }

        /** Edges from the selected node to its strongest visible neighbours. */
        function highlightEdgeFilter() {
            var strong = focusLabelIds();
            var incident = ['any',
                ['all', ['==', ['get', 's'], selectedIndex], ['in', ['get', 't'], ['literal', strong]]],
                ['all', ['==', ['get', 't'], selectedIndex], ['in', ['get', 's'], ['literal', strong]]]
            ];
            var base = edgeFilter();
            return base ? ['all', base, incident] : incident;
        }

        /** The selected node and its strongest visible neighbours, in that order. */
        function focusLabelIds() {
            var ids = [selectedIndex];
            visibleNeighbours(selectedIndex).slice(0, FOCUS_LABELS)
                .forEach(function (nb) { ids.push(nb.j); });
            return ids;
        }

        function labelFilter() {
            var base = nodeFilter();
            if (selectedIndex == null) return base;
            var sel = ['in', ['get', 'i'], ['literal', focusLabelIds()]];
            return base ? ['all', base, sel] : sel;
        }

        /**
         * Label priority. Overview: the generator's hubs-first rank. With a
         * selection: the selected node first, then its neighbours by link
         * strength, so collision keeps the names the sidebar lists.
         */
        function labelSortKey() {
            if (selectedIndex == null) return ['get', 'rank'];
            var expr = ['match', ['get', 'i']];
            focusLabelIds().forEach(function (id, order) { expr.push(id, order); });
            expr.push(1e6);
            return expr;
        }

        function labelSize() {
            if (selectedIndex == null) return 11;
            return ['case', ['==', ['get', 'i'], selectedIndex], 14, 12];
        }

        function ringFilter(index) {
            return ['==', ['get', 'i'], index == null ? -1 : index];
        }

        function applyFilters() {
            if (!map || !map.getLayer(L_EDGES)) return;
            map.setFilter(L_EDGES, edgeFilter());
            map.setFilter(L_NODES, nodeFilter());
            map.setFilter(L_LABELS, labelFilter());
            map.setLayoutProperty(L_LABELS, 'symbol-sort-key', labelSortKey());
            map.setLayoutProperty(L_LABELS, 'text-size', labelSize());
            if (map.getLayer(L_EDGES_HL)) {
                map.setFilter(L_EDGES_HL,
                    selectedIndex == null ? ['==', ['get', 's'], -1] : highlightEdgeFilter());
            }
            if (map.getLayer(L_RING)) map.setFilter(L_RING, ringFilter(selectedIndex));
            if (map.getLayer(L_HOVER_RING)) map.setFilter(L_HOVER_RING, ringFilter(hoverIndex));
            applySelectionPaint();
        }

        /* --------------------------------------------------------------- */
        /*  Selection                                                       */
        /* --------------------------------------------------------------- */

        function applySelectionPaint() {
            if (!map || !map.getLayer(L_NODES)) return;
            if (selectedIndex == null) {
                map.setPaintProperty(L_EDGES, 'line-opacity', edgeOpacityExpression(0.08, 0.55));
                map.setPaintProperty(L_NODES, 'circle-opacity', hoverOpacityExpression(0.85, 1));
                return;
            }
            // Three tiers. The selected node and its strongest neighbours are
            // opaque (their links re-draw on the highlight layer); its other
            // neighbours are muted but findable; everything else fades nearly
            // out — at 0.18 the rest of a 2,800-node graph still read as one
            // grey mass the neighbourhood was lost in.
            var strong = focusLabelIds();
            var weak = visibleNeighbours(selectedIndex).slice(FOCUS_LABELS)
                .map(function (nb) { return nb.j; });
            map.setPaintProperty(L_EDGES, 'line-opacity', edgeOpacityExpression(0.01, 0.04));
            map.setPaintProperty(L_NODES, 'circle-opacity', [
                'case',
                ['in', ['get', 'i'], ['literal', strong]], 1,
                ['in', ['get', 'i'], ['literal', weak]], 0.3,
                0.07
            ]);
        }

        function buildSelection(index) {
            var node = data.nodes[index];
            var neighbors = visibleNeighbours(index).map(function (nb) {
                return { index: nb.j, node: data.nodes[nb.j], weight: nb.w };
            });
            return { index: index, node: node, neighbors: neighbors };
        }

        /**
         * Frame the selected node with its strongest visible neighbours. The
         * old focus centred the node at a fixed zoom, which left most of the
         * neighbours the sidebar named off-screen: the reader saw highlight
         * lines running out of the frame and no names.
         */
        function fitNeighbourhood(index) {
            var node = data.nodes[index];
            var pts = [node];
            visibleNeighbours(index).slice(0, FOCUS_FIT).forEach(function (nb) {
                pts.push(data.nodes[nb.j]);
            });
            try {
                if (pts.length < 2) {
                    map.easeTo({
                        center: [node.lng, node.lat],
                        zoom: Math.max(map.getZoom(), mode === 'geo' ? 6.5 : 3.2),
                        duration: P.mapMotion(600)
                    });
                    return;
                }
                var b = coreBounds(pts, 0);
                map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
                    // Wider than the map default: the framed nodes carry
                    // labels, and one on the edge was cut by the canvas.
                    padding: P.FIT_OPTS.padding * 1.75,
                    maxZoom: mode === 'geo' ? 7 : 6,
                    duration: P.mapMotion(600)
                });
            } catch (e) { /* degenerate bounds */ }
        }

        /**
         * Select a node (null clears). Selecting also frames its
         * neighbourhood unless `opts.fit === false`; re-selecting the
         * current node re-frames it without re-announcing it.
         */
        function select(index, opts) {
            var fit = !opts || opts.fit !== false;
            if (index != null && fit && data && data.nodes[index]) {
                hideHover();
                fitNeighbourhood(index);
            }
            if (index === selectedIndex) return;
            selectedIndex = index;
            applyFilters();
            onSelect(index == null ? null : buildSelection(index));
        }

        /**
         * A filter change while a node is selected changes which of its
         * neighbours are visible: tell the sidebar, or it keeps listing
         * links the map has just hidden.
         */
        function filtersChanged() {
            applyFilters();
            if (selectedIndex != null) onSelect(buildSelection(selectedIndex));
        }

        /* --------------------------------------------------------------- */
        /*  Paint expressions                                               */
        /* --------------------------------------------------------------- */

        function edgeOpacityExpression(min, max) {
            min *= edgeDensity;
            max *= edgeDensity;
            return ['+', min, ['*', max - min, ['get', 'wn']]];
        }

        function hoverOpacityExpression(base, hovered) {
            return [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                hovered,
                base
            ];
        }

        /* --------------------------------------------------------------- */
        /*  Layer (re)build — runs on every style.load (theme swaps too)    */
        /* --------------------------------------------------------------- */

        function addAll(m) {
            if (!data) return;
            var c = colors();

            if (!m.getSource(SRC_EDGES)) {
                m.addSource(SRC_EDGES, { type: 'geojson', data: edgeFeatures, generateId: true });
            }
            if (!m.getSource(SRC_NODES)) {
                m.addSource(SRC_NODES, { type: 'geojson', data: nodeFeatures, generateId: true });
            }

            if (!m.getLayer(L_EDGES)) {
                m.addLayer({
                    id: L_EDGES,
                    type: 'line',
                    source: SRC_EDGES,
                    layout: { 'line-cap': 'round' },
                    paint: {
                        'line-color': mode === 'geo' ? c.inkLight : c.muted,
                        'line-width': ['+', 0.4, ['*', 2.1, ['get', 'wn']]],
                        'line-opacity': edgeOpacityExpression(0.08, 0.55)
                    }
                });
            }
            if (!m.getLayer(L_EDGES_HL)) {
                m.addLayer({
                    id: L_EDGES_HL,
                    type: 'line',
                    source: SRC_EDGES,
                    filter: ['==', ['get', 's'], -1],
                    layout: { 'line-cap': 'round' },
                    paint: {
                        'line-color': c.primary,
                        'line-width': ['+', 1, ['*', 2.5, ['get', 'wn']]],
                        'line-opacity': 0.85
                    }
                });
            }
            if (!m.getLayer(L_NODES)) {
                m.addLayer({
                    id: L_NODES,
                    type: 'circle',
                    source: SRC_NODES,
                    paint: {
                        'circle-radius': ['get', 'r'],
                        'circle-color': nodeColorExpression(c),
                        'circle-opacity': hoverOpacityExpression(0.85, 1),
                        'circle-stroke-width': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            2.5,
                            1
                        ],
                        'circle-stroke-color': c.surface
                    }
                });
            }
            if (!m.getLayer(L_RING)) {
                m.addLayer({
                    id: L_RING,
                    type: 'circle',
                    source: SRC_NODES,
                    filter: ringFilter(null),
                    paint: {
                        'circle-radius': ['+', ['get', 'r'], 4],
                        'circle-opacity': 0,
                        'circle-stroke-width': 2.5,
                        'circle-stroke-color': c.primary
                    }
                });
            }
            if (!m.getLayer(L_HOVER_RING)) {
                m.addLayer({
                    id: L_HOVER_RING,
                    type: 'circle',
                    source: SRC_NODES,
                    filter: ringFilter(null),
                    paint: {
                        'circle-radius': ['+', ['get', 'r'], 3],
                        'circle-opacity': 0,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': c.ink
                    }
                });
            }
            if (!m.getLayer(L_LABELS)) {
                m.addLayer({
                    id: L_LABELS,
                    type: 'symbol',
                    source: SRC_NODES,
                    layout: {
                        'text-field': ['get', 'label'],
                        // Served by the CartoCDN glyph endpoint both the
                        // basemaps and P.buildGraphStyle point at.
                        'text-font': ['Noto Sans Regular'],
                        'text-size': labelSize(),
                        'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
                        'text-radial-offset': ['+', 0.4, ['/', ['get', 'r'], 14]],
                        'text-justify': 'auto',
                        // Lower = more important: wins label collision.
                        // `applyFilters` swaps in the selection's order.
                        'symbol-sort-key': labelSortKey()
                    },
                    paint: {
                        'text-color': c.ink,
                        'text-halo-color': c.surface,
                        'text-halo-width': 1.2
                    }
                });
            }

            applyFilters();

            if (!fitted && bounds) {
                fitted = true;
                try {
                    m.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                        { padding: P.FIT_OPTS.padding, duration: 0 });
                } catch (e) { /* degenerate bounds */ }
            }
        }

        /* --------------------------------------------------------------- */
        /*  Hover popup                                                     */
        /* --------------------------------------------------------------- */

        function hoverContent(f) {
            var node = data && data.nodes[Number(f.properties.i)];
            if (!node) return null;
            var bits = [];
            if (data.types && node.type != null && data.types[node.type]) {
                bits.push(P.t('entity_type_' + data.types[node.type]));
            }
            // Numbers, not formatNumber() strings — see details.js.
            bits.push(P.t('items_count', { count: node.count }));
            bits.push(P.t('links_count', { count: node.degree }));
            return {
                title: node.label,
                subtitleLines: [bits.join(' · ')],
                more: P.t('Click for details')
            };
        }

        function hideHover() {
            if (hover) hover.hide();
        }

        /* --------------------------------------------------------------- */
        /*  Map                                                             */
        /* --------------------------------------------------------------- */

        var mapConfig = {
            onStyleReady: addAll,
            navigation: true,
            // One block-level toggle expands the whole layout — toolbar,
            // graph and details sidebar — through `P.bindFullscreen`. A
            // MapLibre control on each of the two maps targeted that same
            // layout: the lazily built Places graph's offered "Enter
            // fullscreen" while the block already was, and on an iPhone its
            // pseudo-fullscreen fallback got none of the layout's rules.
            fullscreen: false,
            // Names the canvas for a screen reader, which otherwise reaches
            // an interactive region it can only call "application".
            title: mode === 'geo'
                ? P.t('Network of places recorded on the same items')
                : P.t('Network of entries recorded on the same items')
        };
        if (mode === 'abstract') {
            mapConfig.styleMode = 'graph';
            mapConfig.globe = false;
            mapConfig.center = [0, 0];
            mapConfig.zoom = 1;
            mapConfig.mapOptions = {
                attributionControl: false,
                renderWorldCopies: false,
                dragRotate: false,
                pitchWithRotate: false,
                maxBounds: [[-179, -85], [179, 85]]
            };
        } else {
            mapConfig.globe = false;
            mapConfig.center = [2, 10];
            mapConfig.zoom = 3;
        }

        var map = P.createIwacMap(container, mapConfig);
        if (!map) return null;

        map.on('click', function (e) {
            if (!map.getLayer(L_NODES)) return;
            var features = map.queryRenderedFeatures(e.point, { layers: [L_NODES] });
            if (features.length) {
                select(Number(features[0].properties.i));
            } else {
                // Clearing keeps the reader's view where it is.
                select(null, { fit: false });
            }
        });
        hover = P.attachMapHoverPopup(map, {
            layer: L_NODES,
            key: function (f) { return Number(f.properties.i); },
            content: hoverContent,
            lngLat: function (f) {
                var node = data.nodes[Number(f.properties.i)];
                return [node.lng, node.lat];
            },
            offset: 12
        });
        P.attachFeatureStateHover(map, { layer: L_NODES, source: SRC_NODES });

        /* --------------------------------------------------------------- */
        /*  Public API                                                      */
        /* --------------------------------------------------------------- */

        return {
            map: map,

            setData: function (next) {
                data = next;
                weightMin = next.weightMin || 0;
                selectedIndex = null;
                fitted = false;
                buildFeatures();
                if (map.isStyleLoaded()) {
                    var srcN = map.getSource(SRC_NODES);
                    var srcE = map.getSource(SRC_EDGES);
                    if (srcN && srcE) {
                        srcN.setData(nodeFeatures);
                        srcE.setData(edgeFeatures);
                        applyFilters();
                    } else {
                        addAll(map);
                    }
                }
                // Not yet loaded: the style.load handler calls addAll.
            },

            setTypeFilter: function (enabledTypeIndexes) {
                typeFilter = (enabledTypeIndexes &&
                    data && data.types &&
                    enabledTypeIndexes.length < data.types.length)
                    ? enabledTypeIndexes.slice()
                    : null;
                if (selectedIndex != null &&
                    typeFilter &&
                    typeFilter.indexOf(data.nodes[selectedIndex].type) === -1) {
                    select(null, { fit: false });
                } else {
                    filtersChanged();
                }
            },

            setWeightMin: function (value) {
                weightMin = value;
                filtersChanged();
            },

            select: select,

            focusNode: function (index) {
                if (!data || !data.nodes[index]) return;
                select(index);
            },

            /** Ring a node while the reader points at its sidebar row. */
            highlight: function (index) {
                hoverIndex = index == null ? null : index;
                if (map.getLayer(L_HOVER_RING)) {
                    map.setFilter(L_HOVER_RING, ringFilter(hoverIndex));
                }
            },

            getWeightMin: function () { return weightMin; },

            getSelection: function () {
                return selectedIndex == null ? null : buildSelection(selectedIndex);
            },

            resize: function () {
                try { map.resize(); } catch (e) { /* ignore */ }
            }
        };
    }

    /** Methods the orchestrator drives — proxied while MapLibre is in flight. */
    var GRAPH_METHODS = [
        'setData', 'setTypeFilter', 'setWeightMin',
        'select', 'focusNode', 'highlight', 'getWeightMin', 'getSelection', 'resize'
    ];

    /**
     * Public entry point. Always returns a controller — never null.
     *
     * The graph draws on a MapLibre canvas, which since v6 is an ES module the
     * page loader imports in PARALLEL with the classic script chain. So at
     * block boot `maplibregl` routinely does not exist yet, and this used to
     * return null on exactly that: the orchestrator read the null as "no map
     * library" and painted a permanent "Map library unavailable" banner over a
     * panel that would have worked a second later. It was a race — a warm cache
     * let MapLibre win and hid it — and de-serializing the loader in v1.52.0
     * made production lose it.
     *
     * `P.deferMaplibre` keeps the synchronous contract the orchestrator needs
     * while moving the wait where it belongs: the panel shows the map spinner,
     * and the error banner is reserved for an import that actually failed.
     */
    function create(container, opts) {
        return P.deferMaplibre(container, function () {
            return createOnMaplibre(container, opts);
        }, GRAPH_METHODS);
    }

    ns.entityNetworks = ns.entityNetworks || {};
    ns.entityNetworks.graph = { create: create, coreBounds: coreBounds };
})();
