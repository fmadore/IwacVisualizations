/**
 * IWAC Visualizations — Person Dashboard: global role facet bar
 *
 * Exposes a tiny observable (`facet.role`, `facet.subscribe`,
 * `facet.set`) that every panel imports. The visual facet bar
 * is rendered via P.buildFacetButtons for styling consistency.
 *
 * Hides a role button if the matching summary slice has zero
 * mentions — avoids surfacing dead tabs for persons who only
 * ever appear as subject or only ever as creator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons) {
        console.warn('IWACVis.person-dashboard/facet: missing panels / buildFacetButtons');
        return;
    }

    function create(initialRole) {
        var state = { role: initialRole || 'all' };
        var subscribers = [];
        return {
            get role() { return state.role; },
            set: function (role) {
                if (role === state.role) return;
                state.role = role;
                subscribers.forEach(function (fn) { fn(role); });
            },
            subscribe: function (fn) { subscribers.push(fn); }
        };
    }

    function render(host, data, facet) {
        var summary = (data && data.summary && data.summary.by_role) || {};
        var roles = [];
        // "All" is always shown when there's any data at all.
        if (summary.all && summary.all.total_mentions > 0) {
            roles.push({ key: 'all', label: P.t('All roles') });
        }
        if (summary.subject && summary.subject.total_mentions > 0) {
            roles.push({ key: 'subject', label: P.t('As subject') });
        }
        if (summary.creator && summary.creator.total_mentions > 0) {
            roles.push({ key: 'creator', label: P.t('As creator') });
        }
        if (roles.length <= 1) {
            // Only 0 or 1 role available → hide the bar entirely
            return;
        }

        var bar = P.buildFacetButtons({
            facets: roles,
            activeKey: facet.role,
            onChange: function (evt) { facet.set(evt.facet); }
        });
        host.appendChild(bar.root);
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.facet = { create: create, render: render };
})();
