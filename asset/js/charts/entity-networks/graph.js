/**
 * IWAC Visualizations — Entity Networks: MapLibre graph renderer
 *
 * Renders a node-link graph with MapLibre GL — the same WebGL renderer
 * every IWAC map already ships — instead of a dedicated graph library.
 * Positions are precomputed (ForceAtlas2 in Python for the abstract
 * entity graph, real coordinates for the geographic place network), so
 * the client does zero layout work and pan/zoom over ~10k edges stays
 * GPU-bound. Symbol layers give label collision for free; popups,
 * fullscreen, download and light/dark theming ride the existing IWAC
 * map infrastructure.
 *
 * Two modes:
 *   - 'abstract' — blank canvas style (P.buildGraphStyle), node color
 *     by entity type from the IWAC qualitative palette
 *   - 'geo'      — regular theme basemap, nodes at true coordinates
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
    if (!P || !P.createIwacMap || !P.createIwacPopup) {
        console.warn('IWACVis.entity-networks/graph: missing deps (need shared/maplibre.js)');
        return;
    }

    var SRC_NODES = 'net-nodes';
    var SRC_EDGES = 'net-edges';
    var L_EDGES = 'net-edge-lines';
    var L_EDGES_HL = 'net-edge-lines-hl';
    var L_NODES = 'net-node-circles';
    var L_LABELS = 'net-node-labels';

    var MIN_RADIUS = 3;
    var MAX_RADIUS = 17;

    function ml(c) {
        return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(c) : c;
    }

    function create(container, opts) {
        opts = opts || {};
        var mode = opts.mode === 'geo' ? 'geo' : 'abstract';
        var onSelect = opts.onSelect || function () {};

        var data = null;          // { nodes, edges, weightMin }
        var adjacency = [];       // node index → [{ j, w }]
        var nodeFeatures = null;
        var edgeFeatures = null;
        var bounds = null;
        var fitted = false;

        var typeFilter = null;    // null = all types, else array of type indexes
        var weightMin = 0;
        var selectedIndex = null;

        var hoverPopup = null;
        var hoverId = null;

        /* --------------------------------------------------------------- */
        /*  Colors — resolved at every (re)build so theme swaps flow in     */
        /* --------------------------------------------------------------- */

        function colors() {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var palette = (ns.getPalette && ns.getPalette()) || [];
            return {
                palette: palette.map(ml),
                primary: ml(tokens.primary || '#e64a19'),
                ink: ml(tokens.ink || '#2c2f37'),
                inkLight: ml(tokens.inkLight || '#535862'),
                muted: ml(tokens.muted || '#767880'),
                surface: ml(tokens.surface || '#fdfdfd'),
                border: ml(tokens.border || '#d4d6da')
            };
        }

        function nodeColorExpression(c) {
            if (mode === 'geo' || !data || !data.types) return c.primary;
            var expr = ['match', ['get', 'type']];
            data.types.forEach(function (_t, idx) {
                expr.push(idx, c.palette[idx % c.palette.length] || c.primary);
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

            adjacency = data.nodes.map(function () { return []; });
            data.edges.forEach(function (e) {
                adjacency[e[0]].push({ j: e[1], w: e[2] });
                adjacency[e[1]].push({ j: e[0], w: e[2] });
            });
            adjacency.forEach(function (list) {
                list.sort(function (a, b) { return b.w - a.w; });
            });

            if (data.bounds) {
                bounds = data.bounds;
            } else {
                var w = 180, s = 90, e2 = -180, n2 = -90;
                data.nodes.forEach(function (n) {
                    if (n.lng < w) w = n.lng;
                    if (n.lng > e2) e2 = n.lng;
                    if (n.lat < s) s = n.lat;
                    if (n.lat > n2) n2 = n.lat;
                });
                bounds = [w, s, e2, n2];
            }
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

        function highlightEdgeFilter() {
            var incident = ['any',
                ['==', ['get', 's'], selectedIndex],
                ['==', ['get', 't'], selectedIndex]
            ];
            var base = edgeFilter();
            return base ? ['all', base, incident] : incident;
        }

        function labelFilter() {
            var base = nodeFilter();
            if (selectedIndex == null) return base;
            var ids = [selectedIndex];
            adjacency[selectedIndex].forEach(function (nb) { ids.push(nb.j); });
            var sel = ['in', ['get', 'i'], ['literal', ids]];
            return base ? ['all', base, sel] : sel;
        }

        function applyFilters() {
            if (!map || !map.getLayer(L_EDGES)) return;
            map.setFilter(L_EDGES, edgeFilter());
            map.setFilter(L_NODES, nodeFilter());
            map.setFilter(L_LABELS, labelFilter());
            if (map.getLayer(L_EDGES_HL)) {
                map.setFilter(L_EDGES_HL,
                    selectedIndex == null ? ['==', ['get', 's'], -1] : highlightEdgeFilter());
            }
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
            // Dim everything except the selected node + its neighborhood;
            // incident edges re-draw at full strength on the highlight layer.
            var ids = [selectedIndex];
            adjacency[selectedIndex].forEach(function (nb) { ids.push(nb.j); });
            map.setPaintProperty(L_EDGES, 'line-opacity', edgeOpacityExpression(0.02, 0.1));
            map.setPaintProperty(L_NODES, 'circle-opacity', [
                'case',
                ['in', ['get', 'i'], ['literal', ids]],
                1,
                0.18
            ]);
        }

        function buildSelection(index) {
            var node = data.nodes[index];
            var neighbors = adjacency[index].map(function (nb) {
                return { index: nb.j, node: data.nodes[nb.j], weight: nb.w };
            });
            return { index: index, node: node, neighbors: neighbors };
        }

        function select(index) {
            if (index === selectedIndex) return;
            selectedIndex = index;
            applyFilters();
            onSelect(index == null ? null : buildSelection(index));
        }

        /* --------------------------------------------------------------- */
        /*  Paint expressions                                               */
        /* --------------------------------------------------------------- */

        function edgeOpacityExpression(min, max) {
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
                        'text-size': 11,
                        'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
                        'text-radial-offset': ['+', 0.4, ['/', ['get', 'r'], 14]],
                        'text-justify': 'auto',
                        // Lower rank = more important: wins label collision.
                        'symbol-sort-key': ['get', 'rank']
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
                        { padding: 40, duration: 0 });
                } catch (e) { /* degenerate bounds */ }
            }
        }

        /* --------------------------------------------------------------- */
        /*  Hover popup                                                     */
        /* --------------------------------------------------------------- */

        function hoverNode(node) {
            var root = P.el('div', 'iwac-vis-map-popup');
            var header = P.el('div', 'iwac-vis-map-popup__header');
            header.appendChild(P.el('strong', 'iwac-vis-map-popup__title', node.label));
            var bits = [];
            if (data.types && node.type != null && data.types[node.type]) {
                bits.push(P.t('entity_type_' + data.types[node.type]));
            }
            bits.push(P.t('items_count', { count: P.formatNumber(node.count) }));
            bits.push(P.t('links_count', { count: P.formatNumber(node.degree) }));
            header.appendChild(P.el('div', 'iwac-vis-map-popup__subtitle', bits.join(' · ')));
            root.appendChild(header);
            root.appendChild(P.el('div', 'iwac-vis-map-popup__more', P.t('Click for details')));
            return root;
        }

        function showHover(e) {
            var f = e.features && e.features[0];
            if (!f) return;
            var index = Number(f.properties.i);
            var node = data && data.nodes[index];
            if (!node) return;
            if (hoverId !== index) {
                hoverId = index;
                if (!hoverPopup) {
                    hoverPopup = P.createIwacPopup({
                        closeButton: false,
                        closeOnClick: false,
                        offset: 12
                    });
                }
                hoverPopup
                    .setLngLat([node.lng, node.lat])
                    .setDOMContent(hoverNode(node))
                    .addTo(map);
            }
        }

        function hideHover() {
            hoverId = null;
            if (hoverPopup) hoverPopup.remove();
        }

        /* --------------------------------------------------------------- */
        /*  Map                                                             */
        /* --------------------------------------------------------------- */

        var mapConfig = {
            onStyleReady: addAll,
            navigation: true
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
                select(null);
            }
        });
        map.on('mousemove', L_NODES, showHover);
        map.on('mouseleave', L_NODES, hideHover);
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
                    select(null);
                } else {
                    applyFilters();
                }
            },

            setWeightMin: function (value) {
                weightMin = value;
                applyFilters();
            },

            select: select,

            focusNode: function (index) {
                var node = data && data.nodes[index];
                if (!node) return;
                hideHover();
                try {
                    map.easeTo({
                        center: [node.lng, node.lat],
                        zoom: Math.max(map.getZoom(), mode === 'geo' ? 6.5 : 3.2),
                        duration: 600
                    });
                } catch (e) { /* ignore */ }
                select(index);
            },

            getSelection: function () {
                return selectedIndex == null ? null : buildSelection(selectedIndex);
            },

            resize: function () {
                try { map.resize(); } catch (e) { /* ignore */ }
            }
        };
    }

    ns.entityNetworks = ns.entityNetworks || {};
    ns.entityNetworks.graph = { create: create };
})();
