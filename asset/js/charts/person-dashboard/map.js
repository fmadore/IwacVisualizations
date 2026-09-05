/**
 * IWAC Visualizations — Person / Entity Dashboard: locations map panel
 *
 * MapLibre bubble map of places mentioned alongside this person or
 * entity. Clicking a bubble opens a popup that lists the articles at
 * that location — title, publisher, publication date, and a link to
 * the Omeka item page — with client-side pagination when the list is
 * long. Reuses createIwacMap + createIwacPopup for theme-aware
 * basemaps and the shared popup CSS hooks.
 *
 * Popups are built as DOM nodes (not HTML strings) and handed to
 * maplibregl.Popup.setDOMContent so per-popup event listeners (prev /
 * next pagination buttons) survive, and so we don't have to escape
 * arbitrary title text back through innerHTML.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.buildMapPopup) {
        console.warn('IWACVis.person-dashboard/map: missing deps (need createIwacMap + buildMapPopup)');
        return;
    }

    // `idx` lets the click handler find the richer source record
    // (including the articles list) from the current `locations`
    // array — feature properties are string-coerced by MapLibre,
    // so we can't stash the array there directly.
    function featuresFrom(locations) {
        return P.buildCountFeatures(locations, {
            toProps: function (l, idx) {
                return { idx: idx, name: l.name, count: l.count };
            }
        }).collection;
    }

    function render(panelEl, data, facet, ctx) {
        // MapLibre arrives as a parallel ES-module import (see
        // P.whenMaplibre), so at first call the global may simply not be here
        // yet. Wait for it, then re-enter — instead of the whole block waiting
        // for a library only this panel uses.
        if (typeof maplibregl === 'undefined') {
            P.withMaplibre(panelEl.chart, function () {
                render(panelEl, data, facet, ctx);
            });
            return;
        }

        var byRole = (data && data.locations && data.locations.by_role) || {};
        // Current-role locations snapshot — refreshed on facet change
        // so the click handler resolves the correct record.
        var currentLocations = byRole[facet.role] || [];

        // Pre-compute the max count across ALL roles so circle radius is
        // stable when the facet changes (otherwise the scale jumps).
        var maxCount = 1;
        ['all', 'subject', 'creator', 'editor'].forEach(function (role) {
            (byRole[role] || []).forEach(function (l) {
                if (l.count > maxCount) maxCount = l.count;
            });
        });

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var mapInstance = null;

        function popupFor(f) {
            var loc = currentLocations[Number(f.properties.idx)];
            if (!loc) return null;
            return {
                title: loc.name,
                titleHref: siteBase ? P.itemUrl(siteBase, loc.o_id) : null,
                subtitleLines: [
                    P.formatNumber(Number(loc.count || 0)) + ' ' + P.t('Mentions').toLowerCase()
                ],
                articles: loc.articles || [],
                siteBase: siteBase
            };
        }

        var createdMap = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                mapInstance = m;
                // `generateId: true` gives MapLibre a stable feature
                // identity so feature-state hover can key on it.
                if (!m.getSource('person-locations')) {
                    m.addSource('person-locations', {
                        type: 'geojson',
                        data: featuresFrom(currentLocations),
                        generateId: true
                    });
                }
                if (!m.getLayer('person-location-circles')) {
                    m.addLayer(P.bubbleLayer({
                        id: 'person-location-circles',
                        source: 'person-locations',
                        radius: P.countRadius('count', maxCount, 3, 24),
                        sortKey: 'count'
                    }));
                }
            }
        });

        // Attach click + hover handlers ONCE per map instance. MapLibre
        // persists map-level (not layer-filtered) handlers across
        // setStyle calls, so they survive theme swaps without
        // re-attachment and don't stack up on every style.load.
        if (createdMap) {
            mapInstance = createdMap;
            // `ease`: pan so the clicked point sits in the upper half of the
            // viewport, giving a popup with an article list room to grow
            // downward without being clipped by the map container.
            P.attachMapClickPopup(createdMap, {
                layers: 'person-location-circles',
                content: popupFor,
                popup: { closeButton: true, closeOnClick: true, maxWidth: '340px' },
                ease: { offset: [0, 80], duration: 300 }
            });
            P.attachFeatureStateHover(createdMap, {
                layer: 'person-location-circles',
                source: 'person-locations'
            });
        }

        // Choropleth toggle. Per-country counts come from the
        // dashboard's separate `countries` panel data — those are
        // already aggregated per role at precompute time, so we just
        // route the active role's slice into the helper. The location
        // bubbles themselves don't carry country tags, so we don't try
        // to derive aggregate counts from them.
        function getCountryCounts(role) {
            var src = data && data.countries && data.countries.by_role;
            if (!src) return {};
            var entries = src[role] || src.all || [];
            var counts = {};
            entries.forEach(function (e) {
                var name = e.name || e.country;
                var val  = e.value != null ? e.value : (e.count != null ? e.count : 0);
                if (name) counts[name] = val;
            });
            return counts;
        }

        var choropleth = null;
        if (createdMap && typeof P.attachChoroplethToggle === 'function') {
            choropleth = P.attachChoroplethToggle(createdMap, {
                countryCounts: getCountryCounts(facet.role),
                bubbleLayers:  ['person-location-circles'],
                basePath:      (ctx && ctx.basePath) || '',
                labelKey:      'mentions'
            });
        }

        // The active role's places as rows — the toolbar's table / CSV and
        // the pointer-free route to them. Places with an authority record
        // link to it.
        if (P.setPanelRows) {
            P.setPanelRows(panelEl.panel, function () {
                var ranked = currentLocations.slice().sort(function (a, b) {
                    return (b.count || 0) - (a.count || 0);
                });
                return ranked.length ? {
                    columns: [
                        { label: P.t('Place'), numeric: false },
                        { label: P.t('Mentions'), numeric: true }
                    ],
                    rows: ranked.map(function (loc) {
                        return [
                            loc.o_id && siteBase ? { text: loc.name, href: siteBase + '/item/' + loc.o_id } : loc.name,
                            loc.count || 0
                        ];
                    })
                } : null;
            });
        }

        facet.subscribe(function () {
            currentLocations = byRole[facet.role] || [];
            if (mapInstance) {
                var src = mapInstance.getSource('person-locations');
                if (src) src.setData(featuresFrom(currentLocations));
            }
            // Mirror the role-faceted counts into the choropleth fill.
            if (choropleth) choropleth.updateCounts(getCountryCounts(facet.role));
            if (P.panelRowsChanged) P.panelRowsChanged(panelEl.panel);
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.map = { render: render };
})();
