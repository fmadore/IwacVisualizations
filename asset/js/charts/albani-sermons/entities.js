/**
 * IWAC Visualizations — Albani Zaria sermons, section 3: people and places.
 *
 * Who and where the sermons name, from a hand-curated list
 * (scripts/albani/entities.json): a named-entity model proposed the
 * candidates once, offline; the generator counts only the aliases a person
 * kept. Three panels:
 *
 *   the places        a map, circle area ∝ mentions, colour by kind of place
 *                     (Nigeria, the Hajj and the Holy Land, the wider world),
 *                     a Nigeria / world camera, the recordings in the popup
 *   the people        a ledger by kind of person — prophets, Companions,
 *                     hadith scholars, the Sokoto jihad, Nigerian preachers,
 *                     politicians, world figures — each name with its count
 *                     and a strip of its rate in every recording
 *   organisations     the same ledger for movements, schools, parties, media
 *
 * Bundle: entities.json, fetched when the section nears the viewport.
 *
 * Depends on: albani-sermons/helpers.js, shared/maplibre.js,
 * shared/map-popup.js, shared/panels-map.js (the `maplibre` need).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var A = ns.albaniSermons;

    var SOURCE_ID = 'albani-places';
    var LAYER_ID = 'albani-place-circles';
    var PLACE_GROUPS = ['nigeria', 'holy', 'world'];
    var PERSON_GROUPS = ['prophets', 'early', 'scholars', 'sokoto', 'nigeria', 'politics', 'world'];
    var ORG_GROUPS = ['movements', 'armed', 'education', 'state', 'international', 'media'];
    var POPUP_RECORDINGS = 5;

    function labelOf(ent) { return A.label(ent, 'label'); }

    function count(ent, scope) { return ((ent.n || {})[scope]) || 0; }

    function spread(ent, scope) { return ((ent.r || {})[scope]) || 0; }

    /* ----------------------------------------------------------------- */
    /*  The places                                                        */
    /* ----------------------------------------------------------------- */

    function groupColor(i) {
        return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(ns.getSeriesColor(i)) : ns.getSeriesColor(i);
    }

    function placesPanel(host, places, metadata, store, ctx) {
        var mapped = places.filter(function (e) { return isFinite(e.lat) && isFinite(e.lon); });
        var unmapped = places.filter(function (e) { return !(isFinite(e.lat) && isFinite(e.lon)); });
        var titles = A.recordingsById(metadata);
        var state = { view: 'nigeria' };

        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('albani_places'),
            P.t('albani_places_desc'), { key: 'albani-places' });
        host.appendChild(panel.panel);
        var controls = P.el('div', 'iwac-vis-albani__controls');
        var view = P.buildSegmented({
            name: 'albani-places-view',
            label: P.t('albani_places_view'),
            active: state.view,
            options: [
                { key: 'nigeria', label: P.t('albani_places_view_nigeria') },
                { key: 'world', label: P.t('albani_places_view_world') }
            ],
            onChange: function (key) {
                state.view = key;
                frame(600);
            }
        });
        controls.appendChild(view.root);
        panel.panel.insertBefore(controls, panel.chart);

        var legend = P.el('ul', 'iwac-vis-albani__map-legend');
        PLACE_GROUPS.forEach(function (g, i) {
            var li = P.el('li', 'iwac-vis-albani__map-legend-item');
            var swatch = P.el('span', 'iwac-vis-albani__map-swatch');
            swatch.style.background = ns.getSeriesColor(i);
            swatch.setAttribute('aria-hidden', 'true');
            li.appendChild(swatch);
            li.appendChild(P.el('span', null, P.t('albani_place_group_' + g)));
            legend.appendChild(li);
        });
        panel.panel.appendChild(legend);
        if (unmapped.length) {
            panel.panel.appendChild(A.note(P.t('albani_places_unmapped', {
                names: unmapped.map(labelOf).join(', ') }), 'iwac-vis-albani__map-note'));
        }

        // The places as rows: the toolbar's table and CSV, and the way to
        // every count without a pointer.
        if (P.setPanelRows) {
            P.setPanelRows(panel.panel, function () {
                var scope = store.get('scope');
                return {
                    columns: [
                        { label: P.t('albani_col_place'), numeric: false },
                        { label: P.t('albani_col_count'), numeric: true },
                        { label: P.t('albani_col_recordings'), numeric: true }
                    ],
                    rows: places.filter(function (e) { return count(e, scope); })
                        .map(function (e) {
                            var name = ctx.siteBase && e.iwac
                                ? { text: labelOf(e), href: P.itemUrl(ctx.siteBase, e.iwac) } : labelOf(e);
                            return [name, count(e, scope), spread(e, scope)];
                        })
                };
            });
        }

        var map = null;

        function features() {
            var scope = store.get('scope');
            return {
                type: 'FeatureCollection',
                features: mapped.filter(function (e) { return count(e, scope); }).map(function (e) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
                        properties: { id: e.id, n: count(e, scope), g: PLACE_GROUPS.indexOf(e.group) }
                    };
                })
            };
        }

        function maxCount() {
            var scope = store.get('scope');
            var max = 1;
            mapped.forEach(function (e) { if (count(e, scope) > max) max = count(e, scope); });
            return max;
        }

        function radius() { return P.countRadius('n', maxCount(), 4, 30); }

        function frame(duration) {
            if (!map) return;
            var pts = mapped.filter(function (e) {
                return count(e, store.get('scope')) && (state.view === 'world' || e.group === 'nigeria');
            }).map(function (e) { return { lng: e.lon, lat: e.lat }; });
            P.fitToPoints(map, pts, { padding: P.FIT_OPTS.padding, maxZoom: 6.5,
                duration: duration == null ? P.FIT_OPTS.duration : duration });
        }

        function popupFor(hit) {
            var ent = null;
            mapped.forEach(function (e) { if (e.id === hit.properties.id) ent = e; });
            if (!ent) return null;
            var scope = store.get('scope');
            var by = (ent.by || {})[scope] || {};
            var recs = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, POPUP_RECORDINGS);
            return {
                title: labelOf(ent),
                titleHref: ctx.siteBase && ent.iwac ? P.itemUrl(ctx.siteBase, ent.iwac) : null,
                subtitleLines: [P.t('albani_entity_line', { count: count(ent, scope),
                    recordings: P.formatNumber(spread(ent, scope)) })],
                articles: recs.map(function (o) {
                    var rec = titles[o] || {};
                    return { o_id: o, title: rec.t || o,
                        publisher: P.t('albani_entity_count', { count: by[o] }), date: rec.y ? String(rec.y) : '' };
                }),
                siteBase: ctx.siteBase,
                pageSize: POPUP_RECORDINGS
            };
        }

        var mapHost = P.el('div', 'iwac-vis-map iwac-vis-albani__map');
        panel.chart.classList.add('iwac-vis-albani__map-host');
        panel.chart.appendChild(mapHost);
        // The panel toolbar's full-screen control, as on every other chart
        // here (MapLibre's own is off: two would compete).
        P.addFullscreenButton(panel.panel, {
            onResize: function () { if (map) map.resize(); }
        });

        P.withMaplibre(mapHost, function () {
            map = P.createIwacMap(mapHost, {
                center: [8, 10],
                zoom: 4.6,
                title: P.t('albani_places'),
                fullscreen: false,
                onStyleReady: function (m) {
                    if (!m.getSource(SOURCE_ID)) {
                        m.addSource(SOURCE_ID, { type: 'geojson', data: features(), generateId: true });
                    }
                    if (!m.getLayer(LAYER_ID)) {
                        // Colours are read here, so a theme swap repaints them.
                        m.addLayer(P.bubbleLayer({
                            id: LAYER_ID,
                            source: SOURCE_ID,
                            radius: radius(),
                            sortKey: 'n',
                            color: ['match', ['get', 'g'], 0, groupColor(0), 1, groupColor(1), groupColor(2)],
                            opacity: [0.72, 0.95],
                            strokeWidth: [1, 2.5]
                        }));
                    }
                }
            });
            if (!map) return;
            P.attachMapClickPopup(map, {
                layers: LAYER_ID,
                content: popupFor,
                popup: { closeButton: true, closeOnClick: true, maxWidth: '320px' }
            });
            if (P.attachFeatureStateHover) P.attachFeatureStateHover(map, { layer: LAYER_ID, source: SOURCE_ID });
            map.once('load', function () { frame(0); });
        });

        store.subscribe(function () {
            if (!map || !map.getSource(SOURCE_ID)) return;
            map.getSource(SOURCE_ID).setData(features());
            if (map.getLayer(LAYER_ID)) map.setPaintProperty(LAYER_ID, 'circle-radius', radius());
        }, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  The people and the organisations: ledgers by group                */
    /* ----------------------------------------------------------------- */

    function ledgerPanel(host, opts, ents, metadata, store, ctx) {
        var recs = A.recordingOrder(metadata);
        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t(opts.title),
            P.t(opts.desc), { key: opts.key });
        panel.chart.classList.add('iwac-vis-albani__list-host');
        host.appendChild(panel.panel);
        var grid = P.el('div', 'iwac-vis-albani__groups');
        panel.chart.appendChild(grid);

        function refresh() {
            var scope = store.get('scope');
            grid.innerHTML = '';
            opts.groups.forEach(function (g) {
                var members = ents.filter(function (e) { return e.group === g && count(e, scope); })
                    .sort(function (a, b) { return count(b, scope) - count(a, scope); });
                if (!members.length) return;
                var block = P.el('section', 'iwac-vis-albani__group');
                block.appendChild(P.el('h4', 'iwac-vis-albani__group-title', P.t(opts.prefix + g)));
                var list = P.el('ol', 'iwac-vis-albani__ledger iwac-vis-albani__ledger--names');
                members.forEach(function (e) {
                    var li = P.el('li', 'iwac-vis-albani__ledger-row');
                    var name;
                    if (ctx.siteBase && e.iwac) {
                        name = P.el('a', 'iwac-vis-albani__ledger-name', labelOf(e));
                        name.href = P.itemUrl(ctx.siteBase, e.iwac);
                    } else {
                        name = P.el('span', 'iwac-vis-albani__ledger-name', labelOf(e));
                    }
                    li.appendChild(name);
                    li.appendChild(P.el('span', 'iwac-vis-albani__ledger-count', P.formatNumber(count(e, scope))));
                    li.appendChild(P.el('span', 'iwac-vis-albani__ledger-spread', P.t('albani_formulae_spread', {
                        count: spread(e, scope), total: P.formatNumber(recs.length) })));
                    li.appendChild(A.rateStrip((e.by || {})[scope], recs, scope));
                    list.appendChild(li);
                });
                block.appendChild(list);
                grid.appendChild(block);
            });
        }
        refresh();
        store.subscribe(refresh, { keys: ['scope'] });
    }

    A.renderEntities = function (section, bundle, store, fetch, ctx) {
        var host = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(host);
        A.lazy(host, function () { return fetch('entities.json'); }, function (data) {
            var ents = (data && data.entities) || [];
            var of = function (type) { return ents.filter(function (e) { return e.type === type; }); };
            placesPanel(host, of('place'), bundle.metadata, store, ctx);
            ledgerPanel(host, {
                key: 'albani-people', title: 'albani_people', desc: 'albani_people_desc',
                groups: PERSON_GROUPS, prefix: 'albani_person_group_'
            }, of('person'), bundle.metadata, store, ctx);
            ledgerPanel(host, {
                key: 'albani-orgs', title: 'albani_orgs', desc: 'albani_orgs_desc',
                groups: ORG_GROUPS, prefix: 'albani_org_group_'
            }, of('org'), bundle.metadata, store, ctx);
        });
    };
})();
