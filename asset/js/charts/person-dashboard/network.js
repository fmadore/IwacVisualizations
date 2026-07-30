/**
 * IWAC Visualizations — Person + Entity Dashboards: Associated entities
 *
 * The TF-IDF ranked neighbourhood of an authority record, drawn as a live
 * d3-force graph on canvas (shared/graph-force.js) rather than the frozen
 * ECharts `graph`/`force` series it used until v1.28.
 *
 * What changed, and why it mattered here specifically:
 *
 *   - The ECharts series ran its layout once and froze it (necessarily:
 *     `layoutAnimation: false` is what stopped a resize or a merge-mode
 *     setOption re-animating every edge). Dragging a node therefore moved
 *     that one node through a static picture — the neighbourhood it belongs
 *     to didn't respond, which is the whole point of dragging a node.
 *   - It had no collision pass for labels, so a 50-node ego graph could
 *     only ever label a handful of them, chosen by draw order.
 *   - Clicking a node navigated straight to `/item/<o_id>`, throwing the
 *     graph away on the obvious "tell me more" gesture. A node now becomes
 *     the selection: its neighbourhood is highlighted, its connections are
 *     named along their edges, and the record is an explicit link in the
 *     card.
 *
 * The payload's second edge layer (neighbour ↔ neighbour, `kind: 'cross'`)
 * is what gives the layout something to find; before v1.28 the precompute
 * emitted a pure star and no renderer could have improved on a ring. Graphs
 * generated before that carry ego edges only and still render.
 *
 * All the entity vocabulary (types, colours, tooltips, record URLs) lives in
 * shared/entity-graph.js, which the article context network shares.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.mountEntityGraph) {
        console.warn('IWACVis.person-dashboard/network: missing deps (need shared/entity-graph.js)');
        return;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};

        var roles = Object.keys(byRole);
        var hasAny = roles.some(function (role) {
            var g = byRole[role];
            return g && g.nodes && g.nodes.length > 1;
        });
        if (!hasAny) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var mounted = P.mountEntityGraph(panelEl, ctx, {
            // Every role's nodes are registered up front, so flipping the facet
            // re-settles the shared node objects rather than seeding a fresh
            // layout — an entity that appears in both roles keeps its place.
            variants: byRole,
            downloadName: 'iwac-associated-entities.png',
            ariaLabel: P.t('Network of the entities most associated with this record. Use the arrow keys to move between them and Enter to select one.')
        });
        if (!mounted) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        // A role can pass the facet bar's "has mentions" test and still yield a
        // network with fewer than two nodes — every neighbour below
        // `min_cooccurrence`, or dropped as collection-wide noise. So the empty
        // state is per-role, not per-panel, and the canvas is cleared with it:
        // leaving the previous role's graph up would silently mislabel it.
        var empty = P.buildEmptyState();
        panelEl.chart.appendChild(empty);

        function apply(warm) {
            var ok = mounted.show(facet.role, warm);
            if (!ok) mounted.clear();
            empty.hidden = ok;
            panelEl.chart.classList.toggle('iwac-vis-graph-host--empty', !ok);
        }

        apply(false);

        // A role flip is a warm update: same node objects, different visible
        // set, so the graph relaxes into the new shape instead of exploding
        // out of one point.
        facet.subscribe(function () { apply(true); });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
