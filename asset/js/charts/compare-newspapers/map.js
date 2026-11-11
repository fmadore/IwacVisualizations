/**
 * IWAC Visualizations — Compare Newspapers block: spatial map panel.
 *
 * Split out of compare-newspapers.js. Builds the MapLibre comparison
 * map — per-corpus heatmap + bubble layers on a shared sqrt scale,
 * click popups joined to the IWAC authority index, and the 4-way
 * choropleth selector control (bubbles / corpus A / corpus B /
 * diverging A minus B). Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/map: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildMap(dataA, dataB, ctx) {
        // Filter out each corpus's own name as a spatial tag — country-
        // scope corpora have their own country tagged on thousands of
        // items (Burkina Faso mentions Burkina Faso), which renders as
        // a single enormous bubble at the country centroid and swamps
        // every other location. Newspaper-scope corpora often do the
        // same with their home country.
        function filterSelf(pts, data) {
            var dropName = null;
            if (data.scope === 'country') dropName = data.name;
            // For a newspaper, drop its top country too — usually the
            // country where the paper is published. The per-corpus JSON
            // carries this in summary.top_country (newspaper scope only).
            var extra = data.summary && data.summary.top_country;
            return pts.filter(function (p) {
                if (dropName && p.name === dropName) return false;
                if (data.scope === 'newspaper' && extra && p.name === extra) return false;
                return true;
            });
        }
        var aPts = filterSelf(dataA.geo_points || [], dataA);
        var bPts = filterSelf(dataB.geo_points || [], dataB);
        if (!aPts.length && !bPts.length) return null;
        if (!P.createIwacMap || !P.createIwacPopup) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Geographic comparison')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.')));

        var mapHost = P.el('div', 'iwac-vis-compare-map iwac-vis-map');
        panel.appendChild(mapHost);

        // Legend
        var legend = P.el('div', 'iwac-vis-compare-map-legend');
        function legendSwatch(cls, label) {
            var wrap = P.el('span', 'iwac-vis-compare-map-legend__swatch');
            wrap.appendChild(P.el('span', 'iwac-vis-compare-map-legend__dot ' + cls));
            wrap.appendChild(document.createTextNode(' ' + label));
            return wrap;
        }
        legend.appendChild(legendSwatch('iwac-vis-compare-map-legend__dot--a', dataA.name));
        legend.appendChild(legendSwatch('iwac-vis-compare-map-legend__dot--b', dataB.name));
        panel.appendChild(legend);

        // The panel returns synchronously — the caller splices it into the
        // grid at a fixed position, so a null here would silently drop the
        // whole "Geographic comparison" section. Only the MAP waits for
        // MapLibre, which since v6 is an ES module imported in parallel with
        // the script chain and therefore routinely not yet present at this
        // point. (This used to `return null` on that check, which meant the
        // panel simply vanished on any page fast enough to render before the
        // import settled.)
        //
        // A corpus switch before the import lands discards this panel
        // (ns.disposeWithin + innerHTML = ''), and disposal only finds maps
        // that exist: one built afterwards into the detached host would
        // never be released. So a host that has left the page builds nothing.
        P.withMaplibre(mapHost, function () {
            if (!mapHost.isConnected) return;
            attachMap();
        });

        // Both corpora's places as rows: the toolbar's table and CSV, which
        // were offered and never had anything to show.
        if (P.setPanelRows) {
            var siteBase = (ctx && ctx.siteBase) || '';
            P.setPanelRows(panel, function () {
                var byName = {};
                function add(pts, key) {
                    pts.forEach(function (p) {
                        var row = byName[p.name] || (byName[p.name] = { p: p, a: 0, b: 0 });
                        row[key] += p.count || 0;
                    });
                }
                add(aPts, 'a');
                add(bPts, 'b');
                var rows = Object.keys(byName).map(function (name) {
                    var r = byName[name];
                    return [siteBase && r.p.o_id ? { text: name, href: P.itemUrl(siteBase, r.p.o_id) } : name,
                        r.p.country || '', r.a, r.b];
                });
                rows.sort(function (x, y) { return (y[2] + y[3]) - (x[2] + x[3]); });
                return rows.length ? {
                    columns: [
                        { label: P.t('Place'), numeric: false },
                        { label: P.t('Country'), numeric: false },
                        { label: dataA.name, numeric: true },
                        { label: dataB.name, numeric: true }
                    ],
                    rows: rows
                } : null;
            });
        }
        return panel;

        function attachMap() {
            // The two corpus colours, read on demand and never captured:
            // both differ between light and dark, and a theme swap rebuilds
            // the layers (onStyleReady) and the choropleth (which keeps the
            // paint objects below by reference) against the new values.
            // Normalised for MapLibre — either may arrive as oklab()/oklch(),
            // which the style validator rejects.
            function sideColors() {
                var cc = CN.compareColors();
                return {
                    a: P.normalizeColorForMapLibre(cc.a),
                    b: P.normalizeColorForMapLibre(cc.b)
                };
            }

            function features(pts) {
                return P.buildCountFeatures(pts, {
                    minCount: 0,
                    toProps: function (p) {
                        return { name: p.name, count: p.count || 0, o_id: p.o_id || null };
                    }
                });
            }
            var geoA = features(aPts);
            var geoB = features(bPts);

            // Shared max count across both sides so the two heatmaps + bubble
            // layers use a single weight scale — direct visual comparison.
            var maxCount = Math.max(geoA.max, geoB.max);
            var sqrtMax = Math.sqrt(maxCount);

            // Heatmap weight curve — sqrt-squashed, like the bubble radius
            // (P.countRadius), so the top handful of places don't saturate
            // the heatmap and wash out the rest.
            function heatWeight() {
                return [
                    'interpolate', ['linear'],
                    ['sqrt', ['max', ['get', 'count'], 1]],
                    1, 0,
                    sqrtMax, 1
                ];
            }

            function heatColor(color) {
                return [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0,   ns.withAlpha(color, 0),
                    0.2, ns.withAlpha(color, 0.25),
                    0.5, ns.withAlpha(color, 0.5),
                    0.8, ns.withAlpha(color, 0.75),
                    1,   ns.withAlpha(color, 0.9)
                ];
            }

            function heatRadius() {
                // Heatmap kernel grows with zoom so hotspots stay readable.
                return [
                    'interpolate', ['linear'], ['zoom'],
                    0, 6,
                    4, 14,
                    7, 28
                ];
            }

            var CIRCLE_LAYERS = ['compare-a-circles', 'compare-b-circles'];

            function addSideLayers(m, sideKey, sourceData, color) {
                var srcId = 'compare-' + sideKey;
                var heatId = srcId + '-heat';
                var circId = srcId + '-circles';
                // Guarded, like every other consumer: `P.carryOwnSources`
                // keeps the module's GeoJSON sources across a theme swap, so
                // an unguarded addSource would throw on the second style.
                // `generateId` keys the feature-state hover.
                if (!m.getSource(srcId)) {
                    m.addSource(srcId, { type: 'geojson', data: sourceData, generateId: true });
                }
                if (m.getLayer(heatId)) m.removeLayer(heatId);
                if (m.getLayer(circId)) m.removeLayer(circId);
                m.addLayer({
                    id: heatId,
                    type: 'heatmap',
                    source: srcId,
                    paint: {
                        'heatmap-weight': heatWeight(),
                        'heatmap-intensity': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 0.8, 8, 2
                        ],
                        'heatmap-color': heatColor(color),
                        'heatmap-radius': heatRadius(),
                        // Fade the heatmap out at higher zoom so the bubble
                        // layer (which is clickable and exact) takes over.
                        'heatmap-opacity': [
                            'interpolate', ['linear'], ['zoom'],
                            0, 0.6,
                            6, 0.5,
                            9, 0.15
                        ]
                    }
                });
                // The shared bubble vocabulary, in the corpus colour. Lighter
                // than a single-corpus map's resting 0.75: two corpora overlap
                // here, over their own heatmaps, and both have to stay legible.
                m.addLayer(P.bubbleLayer({
                    id: circId,
                    source: srcId,
                    sortKey: 'count',
                    radius: P.countRadius('count', maxCount, 2, 16),
                    color: color,
                    stroke: color,
                    opacity: [0.55, 0.9],
                    strokeWidth: [1, 2]
                }));
            }

            var map = P.createIwacMap(mapHost, {
                // The host's accessible name, naming both corpora: the
                // legend that tells the two colours apart is not in it.
                title: P.t('compare_map_title', { a: dataA.name, b: dataB.name }),
                // Default view centered on West Africa — there's no point in
                // fitBounds when the points can span Mecca, Paris, and New
                // York; forcing the view to that bounding box zooms out too
                // far for the primary region of interest.
                center: [0, 10],
                zoom: 3.5,
                // No ResizeObserver of our own: MapLibre (trackResize, on by
                // default) observes its container and resizes itself when
                // the panel's layout settles or reflows.
                onStyleReady: function (m) {
                    var sc = sideColors();
                    addSideLayers(m, 'a', geoA.collection, sc.a);
                    addSideLayers(m, 'b', geoB.collection, sc.b);
                }
            });
            if (!map) return;

            // Hover + click — ONCE per map instance, OUTSIDE onStyleReady:
            // both resolve the layers live, so they follow the rebuild on a
            // theme swap without stacking a copy per toggle.
            P.attachFeatureStateHover(map, [
                { layer: 'compare-b-circles', source: 'compare-b' },
                { layer: 'compare-a-circles', source: 'compare-a' }
            ]);
            P.attachMapClickPopup(map, {
                layers: CIRCLE_LAYERS,
                content: function (f) {
                    var oid = f.properties.o_id;
                    return {
                        title: f.properties.name || '',
                        // The title is the link to the entity, as on every
                        // other bubble map.
                        titleHref: oid && ctx && ctx.siteBase ? P.itemUrl(ctx.siteBase, oid) : null,
                        subtitleLines: [P.formatNumber(f.properties.count || 0) + ' ' + P.t('mentions')]
                    };
                }
            });

            // Choropleth selector — 4-way segmented control replaces the
            // helper's default toggle button on this map. The user picks
            // between four views:
            //
            //   * Bubbles      — both corpora as heatmap + circle layers
            //                     (the original visualisation)
            //   * <A name>     — choropleth fill driven by corpus A's
            //                     per-country mentions, surface→colorA ramp
            //   * <B name>     — same for corpus B, surface→colorB ramp
            //   * A − B        — diverging fill on (aCount − bCount) per
            //                     country: colorB ← surface → colorA. Direct
            //                     comparison of which corpus dominates each
            //                     IWAC country, neutral when balanced.
            //
            // A−B uses the same scaling on both sides (max abs diff)
            // so the saturation between an A-heavy country and a
            // B-heavy country reads as comparable strength.
            //
            // A place's `country` is the IWAC country it LIES IN, or null
            // for a place outside the six (a Mecca, a Paris) — older data
            // carried the first country whose press mentioned it, which
            // filed a Paris tag under Côte d'Ivoire. A null place has no
            // area to shade, so it stays a bubble and adds to no country.
            if (typeof P.attachChoroplethToggle === 'function') {
                var aCounts = {};
                var bCounts = {};
                aPts.forEach(function (p) {
                    if (!p || !p.country) return;
                    aCounts[p.country] = (aCounts[p.country] || 0) + (p.count || 0);
                });
                bPts.forEach(function (p) {
                    if (!p || !p.country) return;
                    bCounts[p.country] = (bCounts[p.country] || 0) + (p.count || 0);
                });
                // Diff: aCount − bCount over the union of country keys.
                // Missing entries on either side default to 0, so a
                // country exclusive to one corpus comes out as ±count
                // (saturated end of the diverging palette).
                var diffCounts = {};
                var allCountries = {};
                for (var ka in aCounts) { if (aCounts.hasOwnProperty(ka)) allCountries[ka] = true; }
                for (var kb in bCounts) { if (bCounts.hasOwnProperty(kb)) allCountries[kb] = true; }
                for (var kc in allCountries) {
                    if (allCountries.hasOwnProperty(kc)) {
                        diffCounts[kc] = (aCounts[kc] || 0) - (bCounts[kc] || 0);
                    }
                }

                // Getters, so the choropleth resolves the current theme's
                // colours whenever it rebuilds its fill, whichever of its
                // style.load handler and onStyleReady runs first.
                var paintA = { mode: 'sequential', get accentColor() { return sideColors().a; } };
                var paintB = { mode: 'sequential', get accentColor() { return sideColors().b; } };
                var paintDiff = {
                    mode: 'diverging',
                    get negColor() { return sideColors().b; },
                    get posColor() { return sideColors().a; },
                    get neutralColor() {
                        return ((ns.getChartTokens && ns.getChartTokens()) || {}).surface;
                    }
                };

                var choropleth = P.attachChoroplethToggle(map, {
                    countryCounts:      aCounts,
                    bubbleLayers:       [
                        'compare-a-heat', 'compare-a-circles',
                        'compare-b-heat', 'compare-b-circles'
                    ],
                    basePath:           (ctx && ctx.basePath) || '',
                    labelKey:           'mentions',
                    hideDefaultControl: true,
                    paint:              paintA
                });

                // Custom MapLibre control with 4 segmented buttons — sits
                // top-right alongside the navigation / globe / fullscreen
                // controls. State is owned by `currentSelector`; the bubble
                // mode resets the selector but the helper's internal mode
                // tracking handles layer visibility.
                var nameA = dataA.name || 'A';
                var nameB = dataB.name || 'B';
                var selectorModes = [
                    { key: 'bubbles', label: P.t('Bubbles'),       title: P.t('Show point bubbles') },
                    { key: 'a',       label: nameA,                title: nameA },
                    { key: 'b',       label: nameB,                title: nameB },
                    { key: 'diff',    label: nameA + ' − ' + nameB, title: P.t('Diverging A minus B') }
                ];

                function CompareSelectorCtrl() {}
                CompareSelectorCtrl.prototype.onAdd = function () {
                    var c = document.createElement('div');
                    c.className = 'maplibregl-ctrl maplibregl-ctrl-group iwac-vis-compare-choropleth-ctrl';
                    this._buttons = {};
                    var self = this;
                    selectorModes.forEach(function (m) {
                        var b = document.createElement('button');
                        b.type = 'button';
                        b.className = 'iwac-vis-compare-choropleth-ctrl__btn';
                        b.dataset.mode = m.key;
                        b.title = m.title;
                        b.setAttribute('aria-label', m.title);
                        b.textContent = m.label;
                        b.addEventListener('click', function () {
                            applySelector(m.key);
                            self._setActive(m.key);
                        });
                        c.appendChild(b);
                        self._buttons[m.key] = b;
                    });
                    this._container = c;
                    this._setActive('bubbles');
                    return c;
                };
                CompareSelectorCtrl.prototype.onRemove = function () {
                    if (this._container && this._container.parentNode) {
                        this._container.parentNode.removeChild(this._container);
                    }
                };
                CompareSelectorCtrl.prototype._setActive = function (key) {
                    if (!this._buttons) return;
                    for (var k in this._buttons) {
                        if (!this._buttons.hasOwnProperty(k)) continue;
                        var on = (k === key);
                        this._buttons[k].classList.toggle('iwac-vis-compare-choropleth-ctrl__btn--active', on);
                        this._buttons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
                    }
                };

                function applySelector(key) {
                    if (key === 'bubbles') {
                        choropleth.setMode('bubbles');
                    } else if (key === 'a') {
                        choropleth.updateCounts(aCounts,    { paint: paintA });
                        choropleth.setMode('choropleth');
                    } else if (key === 'b') {
                        choropleth.updateCounts(bCounts,    { paint: paintB });
                        choropleth.setMode('choropleth');
                    } else if (key === 'diff') {
                        choropleth.updateCounts(diffCounts, { paint: paintDiff });
                        choropleth.setMode('choropleth');
                    }
                }

                map.addControl(new CompareSelectorCtrl(), 'top-right');
            }
        }
    }

    CN.buildMap = buildMap;
})();
