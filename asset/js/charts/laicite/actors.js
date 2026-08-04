/**
 * IWAC Visualizations — Laïcité block: Actors & institutions (issue #14, view 7).
 *
 * Who is speaking laïcité, in which decade, and in which country. Built from
 * the curated authority records co-occurring with the dossier's items, so
 * every row is a real catalogued entity with its own page rather than a
 * string harvested from text.
 *
 * Two panels:
 *   - a decade heatmap over the top actors, which is what answers "who was
 *     speaking laïcité *then*" — the ranked list alone flattens sixty years
 *     into one column and hides every succession;
 *   - the ranked list itself, where each row links to the entity's record
 *     and carries its span, its corpora and its tagged share.
 *
 * Counted once per item throughout: an organisation named three times in
 * one article is one article's worth of evidence.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite actors: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /** Authority types, in the order the filter offers them. */
    L.ACTOR_TYPES = ['Personnes', 'Organisations', 'Événements'];

    /** How many actors the heatmap can carry before it stops being readable. */
    var HEATMAP_ROWS = 20;

    /** The type keys actually present in the bundle, in canonical order. */
    L.actorTypes = function (bundle) {
        var present = {};
        ((bundle || {}).actors || []).forEach(function (a) {
            present[a.type] = true;
        });
        return L.ACTOR_TYPES.filter(function (t) { return present[t]; });
    };

    function filtered(bundle, state) {
        var actors = (bundle || {}).actors || [];
        if (!state.actorType) return actors;
        return actors.filter(function (a) { return a.type === state.actorType; });
    }

    /**
     * @param {Object} cfg {bundle, state, siteBase}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildActors = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-actors');
        var mounts = [];

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.actors_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.actors_desc')));

        if (!bundle) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var actors = filtered(bundle, cfg.state);
        if (!actors.length) {
            panel.appendChild(P.buildEmptyState('laicite.actors_empty'));
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var heat = buildHeatmap(bundle, actors);
        if (heat) {
            panel.appendChild(heat.chart);
            mounts.push(heat.mount);
        }
        panel.appendChild(buildActorList(actors, cfg));

        // The join is a join: some subject strings match no authority record
        // at all, and a panel built on a lookup should say how lossy the
        // lookup was rather than presenting its output as the whole truth.
        var method = P.el('div', 'iwac-vis-laicite-method');
        method.appendChild(P.el('p', null, P.t('laicite.actors_note')));
        method.appendChild(P.el('p', 'iwac-vis-laicite-method-stats',
            P.t('laicite.actors_method', {
                min: bundle.min_items,
                records: P.formatNumber(bundle.index_records || 0),
                unresolved: P.formatNumber(bundle.unresolved_total || 0)
            })));
        panel.appendChild(method);

        root.appendChild(panel);
        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };

    /**
     * Actors × decades, as shares of each actor's own total rather than raw
     * counts. Row-normalised because the question is *when* an actor speaks,
     * not how large it is — the ranked list below already answers size, and
     * on raw counts the three or four biggest records would be the only
     * cells with any colour at all.
     */
    function buildHeatmap(bundle, actors) {
        var decades = bundle.decades || [];
        if (decades.length < 2) return null;
        var rows = actors.slice(0, HEATMAP_ROWS);
        if (rows.length < 2) return null;

        var yLabels = rows.map(function (a) { return a.name; });
        var cells = [];
        rows.forEach(function (actor, y) {
            var total = (actor.by_decade || []).reduce(function (s, n) {
                return s + n;
            }, 0) || 1;
            decades.forEach(function (decade, x) {
                var n = (actor.by_decade || [])[x] || 0;
                cells.push([x, y, Math.round((n / total) * 100), n]);
            });
        });

        var chart = P.el('div', 'iwac-vis-chart iwac-vis-laicite-actors-chart');
        return {
            chart: chart,
            mount: function () {
                ns.registerChart(chart, function (el, instance) {
                    var C = ns.chartOptions;
                    if (!C || !C.heatmapMatrix) {
                        instance.setOption(P.emptyChartOption(), { notMerge: true });
                        return;
                    }
                    instance.setOption(C.heatmapMatrix(
                        { xLabels: decades, yLabels: yLabels, cells: cells },
                        {
                            visualMax: 100,
                            cellLabels: false,
                            cellBorder: true,
                            tooltipFormatter: function (p) {
                                return P.escapeHtml(yLabels[p.value[1]]) + '<br>'
                                    + P.escapeHtml(decades[p.value[0]]) + ': <strong>'
                                    + P.formatNumber(p.value[3]) + '</strong> ('
                                    + p.value[2] + '%)';
                            }
                        }
                    ), { notMerge: true });
                });
            }
        };
    }

    function buildActorList(actors, cfg) {
        var siteBase = cfg.siteBase || '';
        var max = actors.reduce(function (m, a) {
            return Math.max(m, a.items || 0);
        }, 0) || 1;

        var list = P.el('ol', 'iwac-vis-laicite-actor-list');
        actors.forEach(function (actor) {
            var li = P.el('li', 'iwac-vis-laicite-actor');

            var head = P.el('div', 'iwac-vis-laicite-actor-head');
            var name;
            if (siteBase && actor.o_id) {
                name = P.el('a', 'iwac-vis-laicite-actor-name', actor.name);
                name.href = siteBase + '/item/' + actor.o_id;
            } else {
                name = P.el('span', 'iwac-vis-laicite-actor-name', actor.name);
            }
            head.appendChild(name);
            head.appendChild(L.chip(P.t('laicite.actor_type_' + actor.type),
                'is-type'));
            li.appendChild(head);

            var bar = P.el('div', 'iwac-vis-laicite-actor-bar');
            var fill = P.el('span', 'iwac-vis-laicite-actor-fill');
            fill.style.width = Math.max(2, ((actor.items || 0) / max) * 100) + '%';
            bar.appendChild(fill);
            li.appendChild(bar);

            var span = (actor.first_year && actor.last_year)
                ? actor.first_year + '–' + actor.last_year : '—';
            li.appendChild(P.el('p', 'iwac-vis-laicite-actor-meta',
                P.t('laicite.actor_stats', {
                    items: P.formatNumber(actor.items || 0),
                    tagged: P.formatNumber(actor.tagged || 0),
                    span: span
                })));

            // Which corpora carry this actor. A name that only ever appears
            // in the periodicals is a different finding from one the
            // mainstream press also names, and the list is where that shows.
            var corpora = P.el('p', 'iwac-vis-laicite-actor-corpora');
            L.SUBSETS.forEach(function (subset) {
                var n = (actor.by_subset || {})[subset];
                if (!n) return;
                corpora.appendChild(L.chip(
                    L.subsetLabel(subset) + ' ' + P.formatNumber(n), 'is-corpus'));
            });
            if (corpora.childNodes.length) li.appendChild(corpora);

            list.appendChild(li);
        });
        return list;
    }
})();
