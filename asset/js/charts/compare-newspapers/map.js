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

    function hexToRgb(hex) {
        // Accepts #rgb or #rrggbb — returns [r, g, b] for use in rgba() strings.
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

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
        if (typeof maplibregl === 'undefined' || !P.createIwacMap) return null;

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

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var _cc = CN.compareColors();
        // Normalize for MapLibre — colorA may be oklab()/oklch() after
        // theme v2.0.0; the style validator only accepts Color-3 forms.
        // P.normalizeColorForMapLibre canvas-rasterizes to rgb().
        var rawColorA = _cc.a;
        var colorA = P.normalizeColorForMapLibre
            ? P.normalizeColorForMapLibre(rawColorA)
            : rawColorA;
        var colorB = _cc.b;
        // Parse [r,g,b] bytes from either hex or rgb()/rgba() — colorA
        // is rgb() after normalization, colorB stays hex.
        function colorToRgb(c) {
            var m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c);
            if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
            return hexToRgb(c);
        }
        var rgbA = colorToRgb(colorA);
        var rgbB = colorToRgb(colorB);
        function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }

        function toGeoJSON(pts) {
            return {
                type: 'FeatureCollection',
                features: pts.map(function (p) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                        properties: {
                            name: p.name,
                            count: p.count,
                            o_id: p.o_id || null
                        }
                    };
                })
            };
        }
        var geoA = toGeoJSON(aPts);
        var geoB = toGeoJSON(bPts);

        // Shared max count across both sides so the two heatmaps + bubble
        // layers use a single weight scale — direct visual comparison.
        var maxCount = 1;
        aPts.concat(bPts).forEach(function (p) {
            if (p.count > maxCount) maxCount = p.count;
        });

        // Square-root radius scaling keeps the long tail (a country
        // centroid with 2000 mentions) from visually destroying everything
        // else. Under linear scaling a 2000-mention bubble was ~200× bigger
        // than a 10-mention one; sqrt makes it ~14×.
        var sqrtMax = Math.sqrt(maxCount);
        function bubbleRadius() {
            return [
                'interpolate', ['linear'],
                ['sqrt', ['max', ['get', 'count'], 1]],
                1, 3,
                sqrtMax, 16
            ];
        }

        // Heatmap weight curve — also sqrt-squashed so the top handful of
        // places don't saturate the heatmap and wash out the rest.
        function heatWeight() {
            return [
                'interpolate', ['linear'],
                ['sqrt', ['max', ['get', 'count'], 1]],
                1, 0,
                sqrtMax, 1
            ];
        }

        function heatColor(rgb) {
            return [
                'interpolate', ['linear'], ['heatmap-density'],
                0,   rgba(rgb, 0),
                0.2, rgba(rgb, 0.25),
                0.5, rgba(rgb, 0.5),
                0.8, rgba(rgb, 0.75),
                1,   rgba(rgb, 0.9)
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

        function addSideLayers(m, sideKey, sourceData, rgb, solidColor) {
            var srcId = 'compare-' + sideKey;
            var heatId = srcId + '-heat';
            var circId = srcId + '-circles';
            m.addSource(srcId, { type: 'geojson', data: sourceData });
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
                    'heatmap-color': heatColor(rgb),
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
            m.addLayer({
                id: circId,
                type: 'circle',
                source: srcId,
                paint: {
                    'circle-radius': bubbleRadius(),
                    'circle-color': solidColor,
                    'circle-opacity': [
                        'interpolate', ['linear'], ['zoom'],
                        0, 0.25,
                        5, 0.55,
                        8, 0.75
                    ],
                    'circle-stroke-color': solidColor,
                    'circle-stroke-width': 1,
                    'circle-stroke-opacity': 0.9
                }
            });
            return circId;
        }

        // MapLibre reads the container size at init time and only
        // re-measures on window resize. When the block's layout hasn't
        // settled yet (or the map host isn't attached to the DOM),
        // MapLibre falls back to the default 400x300 canvas and never
        // grows to fill its flex panel. A ResizeObserver on the host
        // picks up the first real layout pass and every subsequent
        // container-size change (window resize, flex reflow, etc.),
        // firing map.resize() each time.
        var _mapRef = null;
        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(function () {
                if (_mapRef && typeof _mapRef.resize === 'function') {
                    try { _mapRef.resize(); } catch (e) { /* map removed mid-observe */ }
                }
            });
            ro.observe(mapHost);
            // Stash on the element so disposeCharts() can tear it down
            // when the user swaps corpora.
            mapHost._iwacResizeObserver = ro;
        }

        var map = P.createIwacMap(mapHost, {
            // Default view centered on West Africa — there's no point in
            // fitBounds when the points can span Mecca, Paris, and New
            // York; forcing the view to that bounding box zooms out too
            // far for the primary region of interest.
            center: [0, 10],
            zoom: 3.5,
            onStyleReady: function (m) {
                var layerA = addSideLayers(m, 'a', geoA, rgbA, colorA);
                var layerB = addSideLayers(m, 'b', geoB, rgbB, colorB);

                // Belt-and-suspenders: the container may have grown to
                // its real size between createIwacMap() and now.
                m.resize();

                [layerA, layerB].forEach(function (layerId) {
                    m.on('click', layerId, function (e) {
                        var f = e.features && e.features[0];
                        if (!f) return;
                        var name = f.properties.name || '';
                        var count = f.properties.count || 0;
                        var oid = f.properties.o_id;
                        var html = '<strong>' + P.escapeHtml(name) + '</strong><br>'
                            + P.formatNumber(count) + ' ' + P.t('mentions');
                        if (oid && ctx && ctx.siteBase) {
                            html += '<br><a href="' + ctx.siteBase + '/item/' + oid + '">'
                                + P.t('Open entity') + '</a>';
                        }
                        (P.createIwacPopup ? P.createIwacPopup() : new maplibregl.Popup())
                            .setLngLat(e.lngLat)
                            .setHTML(html)
                            .addTo(m);
                    });
                    m.on('mouseenter', layerId, function () {
                        m.getCanvas().style.cursor = 'pointer';
                    });
                    m.on('mouseleave', layerId, function () {
                        m.getCanvas().style.cursor = '';
                    });
                });
            }
        });

        _mapRef = map;

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
        if (map && typeof P.attachChoroplethToggle === 'function') {
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

            var paintA = { mode: 'sequential', accentColor: colorA };
            var paintB = { mode: 'sequential', accentColor: colorB };
            var paintDiff = {
                mode: 'diverging',
                negColor: colorB,
                posColor: colorA,
                neutralColor: tokens.surface || '#fdfdfd'
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
                c.className = 'maplibregl-ctrl maplibregl-ctrl-group iwac-compare-choropleth-ctrl';
                this._buttons = {};
                var self = this;
                selectorModes.forEach(function (m) {
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'iwac-compare-choropleth-ctrl__btn';
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
                    this._buttons[k].classList.toggle('iwac-compare-choropleth-ctrl__btn--active', on);
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

        return panel;
    }

    CN.buildMap = buildMap;
})();
