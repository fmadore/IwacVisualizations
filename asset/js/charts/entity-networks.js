/**
 * IWAC Visualizations — Entity Networks block (orchestrator)
 *
 * Fetches `asset/data/entity-networks-global.json` (the cross-type
 * entity graph with precomputed ForceAtlas2 positions), builds the
 * mode facet (Entities | Places), the toolbar (type chips, min-weight
 * select, node search) and the graph + details layout, then delegates
 * rendering to the two modules under `asset/js/charts/entity-networks/`:
 *
 *   - graph.js   — MapLibre GL graph renderer (abstract + geo modes)
 *   - details.js — selection sidebar
 *
 * The geographic place network (entity-networks-spatial.json) is
 * fetched lazily on the first switch to "Places".
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.entityNetworks ||
        !ns.entityNetworks.graph || !ns.entityNetworks.details) {
        console.warn('IWACVis entity networks: missing panel modules — check script load order');
        return;
    }
    var P = ns.panels;
    var EN = ns.entityNetworks;

    var SEARCH_CAP = 10;

    var fold = P.foldAccents;

    /** Decode the generator's compact node rows into objects. */
    function decodeGlobal(payload) {
        return {
            types: payload.types,
            weightMin: (payload._meta && payload._meta.weight_min) || 2,
            nodes: payload.nodes.map(function (r) {
                return {
                    id: r[0], label: r[1], type: r[2], count: r[3],
                    degree: r[4], strength: r[5], lng: r[6], lat: r[7], rank: r[8]
                };
            }),
            edges: payload.edges
        };
    }

    function decodeSpatial(payload) {
        return {
            types: null,
            weightMin: (payload._meta && payload._meta.weight_min) || 2,
            bounds: payload.bounds,
            nodes: payload.nodes.map(function (r, i) {
                return {
                    id: r[0], label: r[1], lng: r[2], lat: r[3],
                    count: r[4], degree: r[5], rank: i
                };
            }),
            edges: payload.edges
        };
    }


    function build(container, ctx, base, globalData) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-networks-root');
        container.appendChild(root);

        /* ----------------------------------------------------------- */
        /*  Layout skeleton                                              */
        /* ----------------------------------------------------------- */

        var layout = P.el('div', 'iwac-vis-networks-layout');
        var main = P.el('div', 'iwac-vis-networks-main');
        var aside = P.el('aside', 'iwac-vis-aside iwac-vis-networks-aside');
        layout.appendChild(main);
        layout.appendChild(aside);

        var graphPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-networks-graph-panel',
            P.t('Co-occurrence network'),
            P.t('networks_description')
        );
        main.appendChild(graphPanel.panel);

        var abstractWrap = P.el('div', 'iwac-vis-map iwac-vis-networks-canvas');
        var geoWrap = P.el('div', 'iwac-vis-map iwac-vis-networks-canvas');
        geoWrap.style.display = 'none';
        graphPanel.chart.appendChild(abstractWrap);
        graphPanel.chart.appendChild(geoWrap);

        root.appendChild(layout);

        /* ----------------------------------------------------------- */
        /*  Details sidebar                                              */
        /* ----------------------------------------------------------- */

        var details = EN.details.render(aside, {
            siteBase: ctx.siteBase,
            onJump: function (index) {
                activeGraph().focusNode(index);
            }
        });

        function overviewFor(data, isGeo) {
            var stats = P.t(isGeo ? 'network_stats_places' : 'network_stats_entities', {
                nodes: P.formatNumber(data.nodes.length),
                links: P.formatNumber(data.edges.length)
            });
            var note = P.t('network_links_note', { count: data.weightMin });
            details.setOverview(stats, note);
        }

        /* ----------------------------------------------------------- */
        /*  Graphs (abstract eager, geo lazy)                            */
        /* ----------------------------------------------------------- */

        var mode = 'entities';
        var spatialData = null;
        var spatialPromise = null;

        function handleSelect(selection) {
            var data = mode === 'entities' ? globalData : spatialData;
            details.showSelection(selection, data && data.types);
            if (!selection) overviewFor(data, mode === 'places');
        }

        // `EN.graph.create` is MapLibre-gated and always returns a controller:
        // it holds the map spinner in `abstractWrap` until the library's ESM
        // import settles, replays these calls, and shows the error banner only
        // if the import actually fails. The overview text and the toolbar below
        // describe the DATA, which is already here, so they paint immediately.
        var abstractGraph = EN.graph.create(abstractWrap, {
            mode: 'abstract',
            onSelect: handleSelect
        });
        var geoGraph = null;

        abstractGraph.setData(globalData);
        overviewFor(globalData, false);

        function activeGraph() {
            return mode === 'places' && geoGraph ? geoGraph : abstractGraph;
        }

        function activeData() {
            return mode === 'places' ? spatialData : globalData;
        }

        // The panel toolbar's Download button binds to one canvas; with
        // two stacked map canvases (Entities / Places) it must follow
        // the visible one, or it would export the hidden graph.
        function retargetDownload(visibleEl) {
            if (!P.addDownloadButton) return;
            var btn = graphPanel.panel.querySelector('.iwac-vis-panel-toolbar__btn--download');
            if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
            P.addDownloadButton(graphPanel.panel, visibleEl);
        }

        function showPlaces() {
            if (spatialData) {
                geoWrap.style.display = '';
                abstractWrap.style.display = 'none';
                if (!geoGraph) {
                    geoGraph = EN.graph.create(geoWrap, {
                        mode: 'geo',
                        onSelect: handleSelect
                    });
                    geoGraph.setData(spatialData);
                } else {
                    geoGraph.resize();
                }
                retargetDownload(geoWrap);
                overviewFor(spatialData, true);
                syncToolbar();
                return;
            }
            if (!spatialPromise) {
                graphPanel.chart.classList.add('iwac-vis-networks-loading');
                spatialPromise = P.fetchJSON(base + 'entity-networks-spatial.json')
                    .then(function (payload) {
                        spatialData = decodeSpatial(payload);
                        graphPanel.chart.classList.remove('iwac-vis-networks-loading');
                        if (mode === 'places') showPlaces();
                    })
                    .catch(function (err) {
                        console.error('IWACVis entity networks (spatial):', err);
                        graphPanel.chart.classList.remove('iwac-vis-networks-loading');
                        spatialPromise = null;
                    });
            }
        }

        function showEntities() {
            abstractWrap.style.display = '';
            geoWrap.style.display = 'none';
            abstractGraph.resize();
            retargetDownload(abstractWrap);
            overviewFor(globalData, false);
            syncToolbar();
        }

        /* ----------------------------------------------------------- */
        /*  Mode facet + toolbar                                         */
        /* ----------------------------------------------------------- */

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'entities', label: P.t('Entities') },
                { key: 'places', label: P.t('Places') }
            ],
            activeKey: 'entities',
            onChange: function (evt) {
                if (evt.facet === mode) return;
                mode = evt.facet;
                details.showSelection(null, null);
                if (mode === 'places') {
                    showPlaces();
                } else {
                    showEntities();
                }
            }
        });
        graphPanel.panel.insertBefore(facetBar.root, graphPanel.chart);

        var toolbar = P.el('div', 'iwac-vis-networks-toolbar');
        graphPanel.panel.insertBefore(toolbar, graphPanel.chart);

        // --- Type chips (abstract mode only) --------------------------
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var enabledTypes = globalData.types.map(function (_t, i) { return i; });
        var chipsWrap = P.el('div', 'iwac-vis-networks-typechips');
        var chipButtons = [];
        globalData.types.forEach(function (type, idx) {
            var chip = P.el('button', 'iwac-vis-networks-typechip');
            chip.type = 'button';
            chip.setAttribute('aria-pressed', 'true');
            var dot = P.el('span', 'iwac-vis-networks-typechip__dot');
            dot.style.background = palette[idx % palette.length] || '';
            chip.appendChild(dot);
            chip.appendChild(P.el('span', null, P.t('entity_type_' + type)));
            chip.addEventListener('click', function () {
                var pos = enabledTypes.indexOf(idx);
                if (pos === -1) {
                    enabledTypes.push(idx);
                } else if (enabledTypes.length > 1) {
                    enabledTypes.splice(pos, 1);
                } else {
                    return; // never allow zero enabled types
                }
                chip.classList.toggle('iwac-vis-networks-typechip--off', enabledTypes.indexOf(idx) === -1);
                chip.setAttribute('aria-pressed', enabledTypes.indexOf(idx) === -1 ? 'false' : 'true');
                abstractGraph.setTypeFilter(enabledTypes);
            });
            chipButtons.push(chip);
            chipsWrap.appendChild(chip);
        });
        toolbar.appendChild(chipsWrap);

        // --- Min-weight select ----------------------------------------
        var weightLabel = P.el('label', 'iwac-vis-networks-toolbar__label',
            P.t('Min. link strength'));
        var weightSelect = P.el('select', 'iwac-vis-control iwac-vis-networks-toolbar__select');
        weightLabel.appendChild(weightSelect);
        toolbar.appendChild(weightLabel);

        function fillWeightOptions() {
            weightSelect.innerHTML = '';
            var data = activeData() || globalData;
            var baseMin = data.weightMin;
            var values = [baseMin, 3, 5, 10, 20].filter(function (v, i, arr) {
                return v >= baseMin && arr.indexOf(v) === i;
            });
            values.forEach(function (value) {
                var opt = P.el('option', null,
                    value === baseMin ? P.t('All links') : '≥ ' + value);
                opt.value = String(value);
                weightSelect.appendChild(opt);
            });
            weightSelect.value = String(baseMin);
        }
        weightSelect.addEventListener('change', function () {
            activeGraph().setWeightMin(parseInt(weightSelect.value, 10) || 0);
        });

        // --- Node search (shared debounced dropdown) ---------------------
        var search = P.buildSearchDropdown({
            placeholder: P.t('Find in network'),
            openOnFocus: true,
            classes: {
                root:     'iwac-vis-networks-search',
                input:    'iwac-vis-control iwac-vis-networks-search__input',
                dropdown: 'iwac-vis-networks-search__results',
                item:     'iwac-vis-networks-search__item',
                name:     'iwac-vis-networks-search__item-name',
                count:    'iwac-vis-networks-search__item-count',
                empty:    'iwac-vis-muted'
            },
            getMatches: function (query) {
                query = fold(query);
                var data = activeData();
                if (!data) return [];
                var out = [];
                for (var i = 0; i < data.nodes.length && out.length < SEARCH_CAP; i++) {
                    if (fold(data.nodes[i].label).indexOf(query) === -1) continue;
                    out.push({
                        label: data.nodes[i].label,
                        detail: P.formatNumber(data.nodes[i].count),
                        index: i
                    });
                }
                return out;
            },
            onPick: function (m) {
                activeGraph().focusNode(m.index);
            }
        });
        toolbar.appendChild(search.root);

        function syncToolbar() {
            chipsWrap.style.display = mode === 'entities' ? '' : 'none';
            fillWeightOptions();
            // The select was just reset to the base weight — keep the
            // newly shown graph honest about it.
            activeGraph().setWeightMin(parseInt(weightSelect.value, 10) || 0);
            search.clear();
        }

        fillWeightOptions();
    }

    P.bootBlock({
        selector:       '.iwac-vis-networks',
        warnLabel:      'IWACVis entity networks',
        requireECharts: false,
        dataFile:       'entity-networks-global.json',
        render:         function (container, data, ctx) {
            build(container, ctx, ctx.dataBase, decodeGlobal(data));
        }
    });
})();
