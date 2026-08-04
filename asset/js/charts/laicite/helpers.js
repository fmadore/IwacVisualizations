/**
 * IWAC Visualizations — Laïcité block: shared stateless builders (issue #14).
 *
 * Colour mapping, KPI cards, and the small DOM pieces reused across views.
 * Loaded after laicite/i18n.js, before the view modules and the orchestrator,
 * which alias these via IWACVis.laicite.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite helpers: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    L.SUBSETS = ['articles', 'publications', 'documents', 'references'];

    /** Frame → colour, from the registered IWAC palette so admin-configured
     *  primaries and dark mode flow through. */
    L.buildFrameColorMap = function (frames) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var map = {};
        (frames || []).forEach(function (frame, i) {
            map[frame] = palette.length ? palette[i % palette.length] : undefined;
        });
        return map;
    };

    /** Locale-aware label for a frame key, from the metadata bundle. */
    L.frameLabel = function (metadata, frame) {
        var spec = (metadata.frames || {})[frame];
        if (!spec) return frame;
        return (ns.locale === 'fr' ? spec.fr : spec.en) || spec.en || frame;
    };

    L.subsetLabel = function (subset) {
        return P.t('laicite.subset_' + subset);
    };

    /** Percentage helper that never prints "NaN%" on an empty denominator. */
    L.pct = function (n, d) {
        if (!d) return 0;
        return Math.round((n / d) * 1000) / 10;
    };

    /**
     * The KPI row. Deliberately reports the dossier's own totals and the
     * year span, and keeps `tagged` and `said` side by side rather than
     * collapsing them into one "matches" number — the gap between them is
     * the block's opening argument.
     */
    L.buildMetricCards = function (metadata) {
        var totals = metadata.totals || {};
        var span = metadata.year_range || [];
        // Raw numbers, never pre-formatted strings: buildSummaryCards runs
        // every value through formatNumber itself, so formatting here too
        // rendered the whole row as "NaN". The span is prose, hence `text`.
        var cards = [
            { value: totals.members || 0, labelKey: 'laicite.kpi_members', featured: true },
            { value: totals.tagged || 0, labelKey: 'laicite.kpi_tagged' },
            { value: totals.said || 0, labelKey: 'laicite.kpi_said' },
            { value: totals.occurrences || 0, labelKey: 'laicite.kpi_occurrences' },
            { value: totals.countries || 0, labelKey: 'laicite.kpi_countries' },
            { value: span.length === 2 ? span[0] + '–' + span[1] : '—',
              labelKey: 'laicite.kpi_span', text: true }
        ];
        var el = P.buildSummaryCards(cards);
        el.classList.add('iwac-vis-laicite-metrics');
        return el;
    };

    /**
     * Link out to the concept's curated authority record. The dossier is not
     * only a text search — it joins a real catalogue entry, and saying so
     * matters for a reader deciding how much to trust the selection.
     */
    L.buildAuthorityLink = function (metadata, siteBase) {
        var authority = metadata.authority || {};
        if (!authority.subject_o_id || !siteBase) return null;
        var wrap = P.el('p', 'iwac-vis-laicite-authority');
        var a = P.el('a', 'iwac-vis-laicite-authority-link',
            P.t('laicite.authority_link') + ' — ' + (authority.subject_label || ''));
        a.href = siteBase + '/item/' + authority.subject_o_id;
        wrap.appendChild(a);
        return wrap;
    };

    /**
     * The rights note. Phrased as a limit on what can be *quoted*, not as a
     * pipeline gap — the split is a rights fact about the sources, and the
     * Corpus Health block already uses that wording.
     */
    L.buildRightsNote = function (metadata) {
        var box = P.el('div', 'iwac-vis-laicite-rights');
        box.appendChild(P.el('h5', 'iwac-vis-laicite-rights-title',
            P.t('laicite.rights_title')));
        box.appendChild(P.el('p', 'iwac-vis-laicite-rights-body',
            P.t('laicite.rights_body')));
        return box;
    };

    /** Small labelled chip, used for frames and flags. */
    L.chip = function (text, className, title) {
        var el = P.el('span', 'iwac-vis-laicite-chip ' + (className || ''), text);
        if (title) el.title = title;
        return el;
    };
})();
