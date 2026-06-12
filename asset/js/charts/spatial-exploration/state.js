/**
 * IWAC Visualizations — Spatial Exploration: shared state manager
 *
 * Tiny pub/sub hub between the entity picker sidebar and the map
 * panel. Owns:
 *
 *   - the active entity type tab (Personnes / Organisations /
 *     Événements / Sujets / Lieux)
 *   - the current selection: null (whole collection) or one entity,
 *     hydrated by fetching the entity's existing dashboard fan-out
 *     (person-dashboards/{id}.json or entity-dashboards/{id}.json) —
 *     the same per-entity JSON the resource-page blocks consume, so
 *     locations + per-location article lists are never duplicated
 *   - the country-focus filter (one of the six IWAC countries)
 *   - a fly-to request channel (picker list → map)
 *
 * Subscribers receive the changed key: 'type' | 'selection' |
 * 'focus' | 'flyto'.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.spatial-exploration/state: panels.js must load first');
        return;
    }

    // Keep the most recent dashboard payloads so re-selecting an
    // entity (or browsing back) doesn't re-fetch. Popular entities can
    // weigh a few hundred KB, so cap the cache and evict oldest-first.
    var CACHE_MAX = 24;

    function createState(data, ctx) {
        var listeners = [];
        var cache = new Map();

        var state = {
            data: data,
            ctx: ctx,
            entityType: (data.types && data.types[0]) || 'Personnes',
            // null | { id, label, type, status: 'loading'|'ready'|'error',
            //          locations, countries, summary }
            selection: null,
            focusCountry: null,
            lastFlyTo: null
        };

        // o_id → focus country name, derived once from the world payload
        // (entity dashboards' location entries don't carry a country).
        var locCountry = {};
        var focusCountries = data.focus_countries || [];
        (data.locations || []).forEach(function (row) {
            if (row[5] >= 0) locCountry[row[0]] = focusCountries[row[5]];
        });

        function notify(key) {
            listeners.forEach(function (fn) {
                try { fn(key); } catch (e) {
                    console.error('IWACVis.spatial-exploration: subscriber failed', e);
                }
            });
        }

        state.subscribe = function (fn) { listeners.push(fn); };

        state.locationCountry = function (oId) {
            return locCountry[oId] || null;
        };

        state.setType = function (type) {
            if (type === state.entityType) return;
            state.entityType = type;
            notify('type');
        };

        state.setFocus = function (country) {
            var next = country || null;
            if (next === state.focusCountry) return;
            state.focusCountry = next;
            notify('focus');
        };

        state.requestFlyTo = function (loc) {
            state.lastFlyTo = loc;
            notify('flyto');
        };

        /**
         * Fetch one entity's dashboard JSON (cached). Persons live in
         * their own fan-out directory; every other type shares
         * entity-dashboards/.
         */
        state.fetchDashboard = function (type, id) {
            var dir = type === 'Personnes' ? 'person-dashboards' : 'entity-dashboards';
            var key = dir + '/' + id;
            if (cache.has(key)) return cache.get(key);
            var url = (ctx.basePath || '') +
                '/modules/IwacVisualizations/asset/data/' + key + '.json';
            var promise = P.fetchJSON(url);
            cache.set(key, promise);
            promise.catch(function () { cache.delete(key); });
            if (cache.size > CACHE_MAX) {
                cache.delete(cache.keys().next().value);
            }
            return promise;
        };

        function roleSlice(section) {
            return (section && section.by_role && section.by_role.all) || null;
        }

        state.selectEntity = function (id, label, type) {
            state.selection = {
                id: id, label: label, type: type,
                status: 'loading', locations: [], countries: [], summary: null
            };
            notify('selection');
            state.fetchDashboard(type, id)
                .then(function (d) {
                    // A newer selection may have replaced this one while
                    // the fetch was in flight — never clobber it.
                    if (!state.selection || state.selection.id !== id) return;
                    state.selection.status = 'ready';
                    state.selection.locations = roleSlice(d.locations) || [];
                    state.selection.countries = roleSlice(d.countries) || [];
                    state.selection.summary = roleSlice(d.summary);
                    notify('selection');
                })
                .catch(function (err) {
                    console.error('IWACVis.spatial-exploration: dashboard fetch failed', err);
                    if (!state.selection || state.selection.id !== id) return;
                    state.selection.status = 'error';
                    notify('selection');
                });
        };

        state.clearEntity = function () {
            if (!state.selection) return;
            state.selection = null;
            notify('selection');
        };

        return state;
    }

    ns.spatialExploration = ns.spatialExploration || {};
    ns.spatialExploration.createState = createState;
})();
