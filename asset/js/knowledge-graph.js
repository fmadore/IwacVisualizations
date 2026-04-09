/**
 * Knowledge Graph — loads precomputed JSON files, falls back to REST API.
 *
 * Depends on:
 *   - dashboard-core.js (THEME, COLORS, initChart, truncateLabel, getBasemapStyle)
 *
 * Priority:
 * 1. Try precomputed JSON under the module's asset/data/knowledge-graphs/ directory
 * 2. Fall back to REST API (lightweight: direct relationships only)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) { console.warn('IwacVisualizations: dashboard-core.js must load before knowledge-graph.js'); return; }

    var COLORS = ns.COLORS;
    var THEME = ns.THEME;

    // Property -> category mapping (used in API fallback only).
    var PROP_CAT = {
        'dcterms:creator': 'Person', 'dcterms:contributor': 'Person', 'foaf:member': 'Person',
        'dcterms:subject': 'Subject', 'dcterms:spatial': 'Location', 'dcterms:provenance': 'Location',
        'dcterms:isPartOf': 'Project', 'dcterms:format': 'Genre', 'frapo:isFundedBy': 'Institution',
        'dcterms:relation': 'Related Item', 'dcterms:hasPart': 'Related Item',
        'dcterms:replaces': 'Related Item', 'dcterms:isReplacedBy': 'Related Item',
        'dcterms:hasVersion': 'Related Item', 'dcterms:isVersionOf': 'Related Item',
        'dcterms:hasFormat': 'Related Item'
    };

    function getCat(term) {
        if (PROP_CAT[term]) return PROP_CAT[term];
        if (term.indexOf('marcrel:') === 0) return 'Contributor';
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Load precomputed or fall back to API                               */
    /* ------------------------------------------------------------------ */

    function loadGraphData(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var apiBase = container.dataset.apiBase;
        var precomputedUrl = basePath + '/modules/IwacVisualizations/asset/data/knowledge-graphs/' + itemId + '.json';

        // Try precomputed file first.
        return fetch(precomputedUrl).then(function (resp) {
            if (resp.ok) return resp.json();
            throw new Error('not found');
        }).catch(function () {
            // Fall back to lightweight API (direct relationships only).
            return fetch(apiBase + '/items/' + itemId)
                .then(function (r) { return r.json(); })
                .then(function (item) { return buildFromApi(item); });
        });
    }

    /** Build graph from a single REST API item response (no shared items). */
    function buildFromApi(item) {
        var itemId = item['o:id'];
        var title = item['o:title'] || 'Item';
        var rc = item['o:resource_class'];
        var centerCat = (rc && rc['o:label']) || 'Item';

        var nodes = [], edges = [], categories = [{ name: centerCat }];
        var catMap = {}; catMap[centerCat] = 0;
        var seen = {};

        function ensureCat(name) {
            if (catMap[name] === undefined) { catMap[name] = categories.length; categories.push({ name: name }); }
            return catMap[name];
        }

        nodes.push({ id: 'item_' + itemId, name: title, category: 0, symbolSize: 45, isCenter: true, itemId: itemId });

        for (var key in item) {
            if (!Array.isArray(item[key]) || key.indexOf(':') === -1) continue;
            if (key.indexOf('o:') === 0 || key.indexOf('@') === 0) continue;

            var cat = getCat(key);
            if (!cat) continue;
            var catIdx = ensureCat(cat);

            item[key].forEach(function (v) {
                if (!v.value_resource_id) return;
                var nid = 'resource_' + v.value_resource_id;
                if (!seen[nid]) {
                    seen[nid] = true;
                    nodes.push({ id: nid, name: v.display_title || '', category: catIdx, symbolSize: 22, itemId: v.value_resource_id });
                }
                edges.push({ source: 'item_' + itemId, target: nid, name: v.property_label || key });
            });
        }

        return { nodes: nodes, edges: edges, categories: categories };
    }

    /* ------------------------------------------------------------------ */
    /*  Filter panel                                                       */
    /* ------------------------------------------------------------------ */

    /** True when any shared edge carries IDF metadata (precomputed data). */
    function hasFilterData(data) {
        for (var i = 0; i < data.edges.length; i++) {
            if (data.edges[i].isShared && data.edges[i].idf !== undefined) return true;
        }
        return false;
    }

    /** Build the collapsible slider panel.  Returns {el, onChange}. */
    function buildFilterPanel(data) {
        var stats = data.stats || {};
        var hasShared = false;
        for (var i = 0; i < data.nodes.length; i++) {
            if (data.nodes[i].strength !== undefined) { hasShared = true; break; }
        }

        var maxFreq = stats.maxFreqPct || 100;
        var maxStr  = stats.maxStrength || 10;

        // Outer wrapper
        var wrap = document.createElement('div');
        wrap.className = 'rv-kg-filters';

        // Toggle button
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rv-btn rv-kg-filters-toggle';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Toggle graph filters');
        btn.title = 'Filters';
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
        wrap.appendChild(btn);

        // Panel (hidden by default)
        var panel = document.createElement('div');
        panel.className = 'rv-kg-filters-panel';
        panel.hidden = true;
        wrap.appendChild(panel);

        btn.addEventListener('click', function () {
            var open = panel.hidden;
            panel.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
            btn.classList.toggle('rv-btn-active', open);
        });

        // State for slider values
        var state = {
            maxCommonality: Math.ceil(maxFreq),
            minStrength: 0,
            maxNodes: data.nodes.length,
        };
        var callbacks = [];

        function fireChange() {
            for (var i = 0; i < callbacks.length; i++) callbacks[i](state);
        }

        // ── Max commonality slider ──
        var s1 = makeSlider(
            'Max. commonality',
            'Hide connections through resources shared by too many items',
            1, Math.ceil(maxFreq), state.maxCommonality, '%'
        );
        panel.appendChild(s1.el);
        s1.onInput(function (v) { state.maxCommonality = v; fireChange(); });

        // ── Min strength slider ──
        if (hasShared) {
            // Round up for slider max so the entire range is reachable.
            var strMax = Math.ceil(maxStr);
            if (strMax < 1) strMax = 1;
            var s2 = makeSlider(
                'Min. connection strength',
                'Only show shared items with strong distinctive links',
                0, strMax, 0, ''
            );
            panel.appendChild(s2.el);
            s2.onInput(function (v) { state.minStrength = v; fireChange(); });
        }

        // ── Max neighbours slider ──
        var totalNodes = data.nodes.length;
        if (totalNodes > 10) {
            var s3 = makeSlider(
                'Max. neighbours',
                'Limit the number of visible nodes',
                5, totalNodes, totalNodes, ''
            );
            panel.appendChild(s3.el);
            s3.onInput(function (v) { state.maxNodes = v; fireChange(); });
        }

        return {
            el: wrap,
            onChange: function (cb) { callbacks.push(cb); },
            state: state,
        };
    }

    /** Create a single labelled range slider.  Returns {el, onInput}. */
    function makeSlider(label, description, min, max, value, suffix) {
        var row = document.createElement('div');
        row.className = 'rv-kg-slider';

        var lbl = document.createElement('label');

        // Top row: label text + current value, side by side.
        var topRow = document.createElement('span');
        topRow.className = 'rv-kg-slider-label';

        var labelText = document.createElement('span');
        labelText.textContent = label;
        topRow.appendChild(labelText);

        var val = document.createElement('span');
        val.className = 'rv-kg-slider-value';
        val.textContent = value + suffix;
        topRow.appendChild(val);

        lbl.appendChild(topRow);

        // Second row: full-width slider.
        var input = document.createElement('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.value = value;
        lbl.appendChild(input);

        row.appendChild(lbl);

        // Third row: description.
        if (description) {
            var desc = document.createElement('div');
            desc.className = 'rv-kg-slider-desc';
            desc.textContent = description;
            row.appendChild(desc);
        }

        var cbs = [];
        input.addEventListener('input', function () {
            var v = Number(input.value);
            val.textContent = v + suffix;
            for (var i = 0; i < cbs.length; i++) cbs[i](v);
        });

        return { el: row, onInput: function (cb) { cbs.push(cb); } };
    }

    /* ------------------------------------------------------------------ */
    /*  Filtering logic                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Apply slider filters to the full graph data and return a filtered copy.
     *
     * Pipeline:
     * 1. Keep all direct (non-shared) edges.
     * 2. Keep shared edges where freqPct <= maxCommonality.
     * 3. For each shared node, recompute effective strength from surviving
     *    edges; drop node if strength < minStrength.
     * 4. Remove orphaned edges (edges pointing to removed nodes).
     * 5. Cap at maxNodes (keep center + highest-strength shared + all direct).
     */
    function filterGraph(allNodes, allEdges, state) {
        var maxC = state.maxCommonality;
        var minS = state.minStrength;
        var maxN = state.maxNodes;

        // Step 1-2: filter edges by commonality.
        var edges = [];
        for (var i = 0; i < allEdges.length; i++) {
            var e = allEdges[i];
            if (e.isShared) {
                if ((e.freqPct || 0) <= maxC) edges.push(e);
            } else {
                edges.push(e);
            }
        }

        // Step 3: recompute strength for shared nodes from surviving edges.
        var nodeStrength = {};  // node id → effective strength
        for (i = 0; i < edges.length; i++) {
            var ed = edges[i];
            if (ed.isShared) {
                nodeStrength[ed.source] = (nodeStrength[ed.source] || 0) + (ed.idf || 0);
            }
        }

        // Build set of kept node IDs.
        var keptIds = {};
        var sharedNodes = [];
        var nonSharedNodes = [];

        for (i = 0; i < allNodes.length; i++) {
            var nd = allNodes[i];
            if (nd.isCenter) {
                keptIds[nd.id] = true;
                continue;
            }
            if (nd.strength !== undefined) {
                // Shared item — check effective strength.
                var eff = nodeStrength[nd.id] || 0;
                if (eff >= minS) {
                    sharedNodes.push({ node: nd, eff: eff });
                }
            } else {
                nonSharedNodes.push(nd);
                keptIds[nd.id] = true;
            }
        }

        // Sort shared nodes by effective strength descending.
        sharedNodes.sort(function (a, b) { return b.eff - a.eff; });

        // Step 5: cap total nodes.
        var remaining = maxN - 1 - nonSharedNodes.length; // -1 for center
        if (remaining < 0) remaining = 0;
        for (i = 0; i < sharedNodes.length && i < remaining; i++) {
            keptIds[sharedNodes[i].node.id] = true;
        }

        // Collect filtered nodes.
        var nodes = [];
        for (i = 0; i < allNodes.length; i++) {
            if (keptIds[allNodes[i].id]) nodes.push(allNodes[i]);
        }

        // Step 4: remove orphaned edges.
        var filteredEdges = [];
        for (i = 0; i < edges.length; i++) {
            if (keptIds[edges[i].source] && keptIds[edges[i].target]) {
                filteredEdges.push(edges[i]);
            }
        }

        return { nodes: nodes, edges: filteredEdges };
    }

    /* ------------------------------------------------------------------ */
    /*  ECharts rendering                                                  */
    /* ------------------------------------------------------------------ */

    /** Map an IDF-weighted edge to a visual width in [minW, maxW]. */
    function edgeWidth(e, maxStr) {
        if (!e.isShared || !maxStr) return 1.5;
        var t = Math.min((e.idf || 0) / maxStr, 1);
        return 0.6 + t * 2.4; // 0.6 – 3.0
    }

    /** Map an IDF-weighted edge to an opacity in [minO, maxO]. */
    function edgeOpacity(e, maxStr) {
        if (!e.isShared || !maxStr) return 0.6;
        var t = Math.min((e.idf || 0) / maxStr, 1);
        return 0.15 + t * 0.55; // 0.15 – 0.70
    }

    function renderChart(container, data, siteBase) {
        // Add URLs to nodes.
        data.nodes.forEach(function (n) {
            if (n.itemId && siteBase) {
                n.url = siteBase + '/item/' + n.itemId;
            }
        });

        var chart = ns.initChart(container);
        var stats = data.stats || {};
        var maxStr = stats.maxStrength || 1;
        var enableFilters = hasFilterData(data);

        data.categories.forEach(function (cat, i) {
            cat.itemStyle = { color: COLORS[i % COLORS.length] };
        });

        // Keep full copies for filtering.
        var allNodes = data.nodes.slice();
        var allEdges = data.edges.slice();

        /** Build an ECharts option from a (possibly filtered) node/edge set. */
        function buildOption(nodes, edges) {
            var n = nodes.length;
            return {
                aria: { enabled: true },
                tooltip: {
                    trigger: 'item',
                    confine: true,
                    extraCssText: 'word-spacing:normal;letter-spacing:normal;white-space:normal;font-family:sans-serif;line-height:1.5;',
                    formatter: function (p) {
                        if (p.dataType === 'node') {
                            var c = data.categories[p.data.category];
                            var t = '<strong>' + echarts.format.encodeHTML(p.name) + '</strong><br/>'
                                + '<span style="color:' + COLORS[p.data.category % COLORS.length] + '">'
                                + echarts.format.encodeHTML(c ? c.name : '') + '</span>';
                            if (p.data.freqPct !== undefined && p.data.freqPct !== null) {
                                t += '<br/><span style="font-size:11px;color:#888">Shared by '
                                    + p.data.freqPct + '% of items</span>';
                            }
                            if (p.data.strength !== undefined) {
                                t += '<br/><span style="font-size:11px;color:#888">'
                                    + p.data.sharedCount + ' shared link' + (p.data.sharedCount > 1 ? 's' : '')
                                    + ' (strength ' + p.data.strength + ')</span>';
                            }
                            if (p.data.url) t += '<br/><span style="font-size:11px;color:#888">Click to open</span>';
                            return t;
                        }
                        if (p.dataType === 'edge') {
                            var lbl = echarts.format.encodeHTML(p.data.name || '');
                            if (p.data.isShared && p.data.freqPct !== undefined) {
                                lbl += '<br/><span style="font-size:11px;color:#888">Resource shared by '
                                    + p.data.freqPct + '% of items</span>';
                            }
                            return lbl;
                        }
                        return '';
                    }
                },
                legend: {
                    data: data.categories.map(function (c) { return c.name; }),
                    bottom: 10, textStyle: { fontSize: THEME.fontSize }, type: 'scroll'
                },
                animationDuration: 300,
                animationEasingUpdate: 'cubicOut',
                series: [{
                    type: 'graph', layout: 'force',
                    data: nodes.map(function (nd) {
                        var sh = !nd.isCenter && nd.symbolSize <= 16;
                        return {
                            id: nd.id, name: nd.name, category: nd.category, url: nd.url || null,
                            symbolSize: nd.symbolSize,
                            freqPct: nd.freqPct, strength: nd.strength, sharedCount: nd.sharedCount,
                            label: {
                                show: !!nd.isCenter, fontSize: nd.isCenter ? THEME.fontSizeTitle : THEME.fontSize,
                                fontWeight: nd.isCenter ? 'bold' : 'normal',
                                width: 150, overflow: 'break'
                            },
                            emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold', width: 180, overflow: 'break' } },
                            itemStyle: nd.isCenter
                                ? { borderColor: '#333', borderWidth: 3, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' }
                                : sh ? { opacity: 0.85 } : { borderColor: '#fff', borderWidth: 1 }
                        };
                    }),
                    links: edges.map(function (e) {
                        return {
                            source: e.source, target: e.target, name: e.name,
                            isShared: !!e.isShared, freqPct: e.freqPct, idf: e.idf,
                            lineStyle: {
                                color: e.isShared ? '#d0d0d0' : '#999',
                                type: e.isShared ? 'dashed' : 'solid',
                                width: edgeWidth(e, maxStr),
                                curveness: 0.15,
                                opacity: edgeOpacity(e, maxStr)
                            }
                        };
                    }),
                    categories: data.categories,
                    force: {
                        repulsion: n > 60 ? 600 : n > 30 ? 450 : 300,
                        gravity: n > 60 ? 0.05 : 0.08,
                        edgeLength: n > 60 ? [40, 250] : [60, 200],
                        friction: 0.85,
                        layoutAnimation: false
                    },
                    roam: true, draggable: true, cursor: 'pointer',
                    emphasis: { focus: 'adjacency', lineStyle: { width: 2.5, opacity: 0.9 } },
                    blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 } },
                    label: { position: 'right', formatter: function (p) { return ns.truncateLabel(p.name, THEME.labelMaxLen); } },
                    lineStyle: { opacity: 0.5, width: 1.2 },
                    scaleLimit: { min: 0.2, max: 5 }
                }]
            };
        }

        // Initial render with all data.
        chart.setOption(buildOption(allNodes, allEdges));

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.url) window.location.href = p.data.url;
        });

        var timer;
        window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { chart.resize(); }, 100); });

        var block = container.closest('.knowledge-graph-block');
        if (block) {
            var toolbar = block.querySelector('.knowledge-graph-toolbar');

            // ── Filter panel ──
            if (enableFilters && toolbar) {
                var filters = buildFilterPanel(data);
                toolbar.insertBefore(filters.el, toolbar.firstChild);

                var filterTimer;
                filters.onChange(function (state) {
                    clearTimeout(filterTimer);
                    filterTimer = setTimeout(function () {
                        var filtered = filterGraph(allNodes, allEdges, state);
                        chart.setOption(buildOption(filtered.nodes, filtered.edges), true);
                    }, 80);
                });
            }

            // ── Save button ──
            if (toolbar) {
                var saveBtn = document.createElement('button');
                saveBtn.type = 'button';
                saveBtn.className = 'rv-btn';
                saveBtn.setAttribute('aria-label', 'Save as image');
                saveBtn.title = 'Save as image';
                saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
                saveBtn.addEventListener('click', function () {
                    var url = chart.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'knowledge-graph.png';
                    a.click();
                });
                toolbar.insertBefore(saveBtn, toolbar.firstChild);
            }

            var toggle = block.querySelector('.rv-fullscreen-toggle');
            if (toggle) {
                toggle.addEventListener('click', function () {
                    block.classList.toggle('rv-fullscreen');
                    setTimeout(function () { chart.resize(); }, 50);
                });
            }
            var onKeydown = function (e) {
                if (e.key === 'Escape' && block.classList.contains('rv-fullscreen')) {
                    block.classList.remove('rv-fullscreen');
                    setTimeout(function () { chart.resize(); }, 50);
                }
            };
            document.addEventListener('keydown', onKeydown);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Item location map                                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Render a MapLibre map showing origin and current locations for an item.
     * @param {HTMLElement} el - Container element for the map.
     * @param {Object} itemMap - { origins: [{name,lat,lon,itemId}], current: [{name,lat,lon,itemId}] }
     * @param {string} siteBase - Base URL for item links.
     */
    function renderItemMap(el, itemMap, siteBase) {
        if (typeof maplibregl === 'undefined') return;
        var origins = itemMap.origins || [];
        var current = itemMap.current || [];
        if (!origins.length && !current.length) return;

        var all = origins.concat(current);

        var map = new maplibregl.Map({
            container: el,
            style: ns.getBasemapStyle(),
            center: [all[0].lon, all[0].lat],
            zoom: 3,
            attributionControl: false,
            scrollZoom: false,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');

        map.on('load', function () {
            // Origin markers (teal).
            origins.forEach(function (loc) {
                var popupHtml = '<strong>' + loc.name + '</strong><br/>'
                    + '<span style="color:' + THEME.accent + '">Origin</span>';
                if (siteBase) popupHtml += '<br/><a href="' + siteBase + '/item/' + loc.itemId + '" style="font-size:12px">View location</a>';
                new maplibregl.Marker({ color: THEME.accent })
                    .setLngLat([loc.lon, loc.lat])
                    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml))
                    .addTo(map);
            });

            // Current location markers (orange).
            current.forEach(function (loc) {
                var popupHtml = '<strong>' + loc.name + '</strong><br/>'
                    + '<span style="color:' + COLORS[1] + '">Current location</span>';
                if (siteBase) popupHtml += '<br/><a href="' + siteBase + '/item/' + loc.itemId + '" style="font-size:12px">View location</a>';
                new maplibregl.Marker({ color: COLORS[1] })
                    .setLngLat([loc.lon, loc.lat])
                    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml))
                    .addTo(map);
            });

            // Fit bounds to all markers.
            if (all.length > 1) {
                var bounds = new maplibregl.LngLatBounds();
                all.forEach(function (loc) { bounds.extend([loc.lon, loc.lat]); });
                map.fitBounds(bounds, { padding: 50, maxZoom: 8 });
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function initKnowledgeGraph(container) {
        if (!container.dataset.itemId) return;
        var siteBase = container.dataset.siteBase || '';

        loadGraphData(container).then(function (data) {
            if (!data || !data.nodes || data.nodes.length < 2) {
                container.innerHTML = '<p class="rv-no-data">No relationships found.</p>';
                return;
            }
            container.innerHTML = '';
            renderChart(container, data, siteBase);

            // If item has location data, render a map below the graph.
            if (data.itemMap && (data.itemMap.origins.length || data.itemMap.current.length)) {
                var block = container.closest('.knowledge-graph-block') || container.parentElement;
                var wrapper = document.createElement('div');
                wrapper.className = 'rv-item-map-panel';

                var heading = document.createElement('h4');
                heading.textContent = 'Locations';
                wrapper.appendChild(heading);

                var legend = document.createElement('div');
                legend.className = 'rv-item-map-legend';
                if (data.itemMap.origins.length) {
                    legend.innerHTML += '<span class="rv-legend-dot" style="background:' + THEME.accent + '"></span> Origin';
                }
                if (data.itemMap.current.length) {
                    legend.innerHTML += '<span class="rv-legend-dot" style="background:' + COLORS[1] + '"></span> Current location';
                }
                wrapper.appendChild(legend);

                var mapEl = document.createElement('div');
                mapEl.className = 'rv-item-map-container';
                wrapper.appendChild(mapEl);

                block.appendChild(wrapper);
                renderItemMap(mapEl, data.itemMap, siteBase);
            }
        }).catch(function (err) {
            console.error('IwacVisualizations:', err);
            container.innerHTML = '<p class="rv-error">Failed to load knowledge graph.</p>';
        });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IwacVisualizations: ECharts not loaded');
            return;
        }
        var cs = document.querySelectorAll('.knowledge-graph-container');
        for (var i = 0; i < cs.length; i++) initKnowledgeGraph(cs[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
