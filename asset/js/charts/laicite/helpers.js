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

    L.SUBSETS = ['articles', 'publications', 'documents', 'audiovisual', 'references'];

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

    function numberLocale() {
        return ns.locale === 'fr' ? 'fr-FR' : 'en-US';
    }

    /**
     * A percentage (0–100, as `L.pct` returns it) written the way the page's
     * locale writes one: "12.5%" in English, "12,5 %" in French. Every
     * `toFixed(1) + '%'` in this block printed the English form on the
     * French site. `digits` is fixed, not a maximum, so a column of shares
     * lines up. null / NaN render as an em dash, never as "NaN%".
     *
     * @param {number|null} value
     * @param {number} [digits=1]
     * @returns {string}
     */
    L.formatPercent = function (value, digits) {
        if (value == null || !isFinite(value)) return '—';
        var d = digits == null ? 1 : digits;
        try {
            return new Intl.NumberFormat(numberLocale(), {
                style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d
            }).format(value / 100);
        } catch (e) {
            return value.toFixed(d) + '%';
        }
    };

    /**
     * A decimal in the page's locale, for a placeholder whose template
     * carries its own sign ("{percent}%" in English, "{percent} %" in
     * French) — the template owns the spacing, this owns the comma. Prose,
     * not a column: `digits` is a maximum, so 40 reads "40", not "40.0".
     *
     * @param {number|null} value
     * @param {number} [digits=1]
     * @returns {string}
     */
    L.formatDecimal = function (value, digits) {
        if (value == null || !isFinite(value)) return '—';
        var d = digits == null ? 1 : digits;
        try {
            return new Intl.NumberFormat(numberLocale(), {
                maximumFractionDigits: d
            }).format(value);
        } catch (e) {
            return String(Math.round(value * Math.pow(10, d)) / Math.pow(10, d));
        }
    };

    /**
     * Phone media for the block's charts whose axes are arrays — two value
     * axes, or the seasonality view's two grids — or whose value axes are
     * named at their ends under a legend. R.valueChartMedia writes ONE grid
     * and ONE yAxis, which ECharts merges into the first of each only, and
     * it moves the top edge and the name gap for a rotated, centred axis
     * name; on these charts that lifted an end-placed name into the legend.
     * So the same phone moves, element-wise and horizontal only: narrower
     * gutters and the small axis type. (Custom for the reason the growth
     * chart in chart-options-bar.js gives.) Seven charts in this block
     * used to pass `R.withMedia(option, {})`, which withMedia ignores, so
     * nothing about them changed on a phone; the four whose axes fit the
     * shared presets take R.valueChartMedia / R.labelMedia, three take this.
     *
     * @param {Object} opts
     * @param {Object|Array<Object>} opts.grid  phone gutters, per grid
     * @param {number} [opts.xAxes=1]
     * @param {number} [opts.yAxes=1]
     * @returns {Array<Object>}  for R.withMedia
     */
    L.phoneMedia = function (opts) {
        opts = opts || {};
        var R = ns.responsive;
        var small = P.AXIS_FONT_SM;
        function axes(n, make) {
            var out = [];
            for (var i = 0; i < (n || 1); i++) out.push(make());
            return out;
        }
        return [{
            query: { maxWidth: R && R.BP ? R.BP.sm : 640 },
            option: {
                grid: opts.grid,
                xAxis: axes(opts.xAxes, function () {
                    return { axisLabel: { fontSize: small } };
                }),
                yAxis: axes(opts.yAxes, function () {
                    return { nameTextStyle: { fontSize: small }, axisLabel: { fontSize: small } };
                })
            }
        }];
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
            { value: totals.countries || 0, labelKey: 'Countries' },
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
        a.href = P.itemUrl(siteBase, authority.subject_o_id);
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

    /**
     * How a record joined the dossier. The generator emits one of four
     * route strings per member; anything else (including nothing at all,
     * on data generated before the routes existed) returns null and the
     * caller renders no chip rather than an "unknown" one.
     */
    L.ROUTE_KEYS = {
        'tag+text': 'laicite.route_tag_text',
        'text>=2': 'laicite.route_text_multi',
        'text=1': 'laicite.route_text_single',
        'tag-only': 'laicite.route_tag_only'
    };

    /** The four routes in the order a reader should read them: strongest first. */
    L.ROUTE_ORDER = ['tag+text', 'text>=2', 'text=1', 'tag-only'];

    L.routeLabel = function (route) {
        var key = L.ROUTE_KEYS[route];
        return key ? P.t(key) : null;
    };

    /**
     * The route as a chip. `text=1` is the one route the September 2026
     * screen found weak, so it is the only one marked as such — colouring
     * all four would say the routes differ in kind rather than in strength.
     */
    L.routeChip = function (route) {
        var label = L.routeLabel(route);
        if (!label) return null;
        return L.chip(label,
            'is-route' + (route === 'text=1' ? ' is-weak' : ''),
            P.t('laicite.route_hint'));
    };
})();
