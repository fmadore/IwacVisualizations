/**
 * IWAC Visualizations — Laïcité block: circulation (issue #19 D).
 *
 * Near-duplicate laïcité articles printed by different outlets.
 *
 * The question none of the other views can answer: does this coverage
 * *circulate*? A communiqué printed verbatim by eleven papers, a wire
 * dispatch picked up across a border, and eleven newsrooms independently
 * covering the same controversy are indistinguishable on a per-year item
 * count — and they are not the same finding. It bears directly on the
 * argument the dossier backs: a claim about the volume of debate is
 * weaker if the volume is one press release printed eleven times.
 *
 * Three parts, in the order the question is actually asked:
 *   1. a headline share — how much of the dossier is duplicated at all;
 *   2. duplication per decade, so the timeline's ridges can be read
 *      against it;
 *   3. the pairs themselves, because "trust me, they're duplicates" is
 *      not an argument a reader can check.
 *
 * The detection floor is the Press Reprints block's own threshold, so a
 * "reprint" means the same thing in both places.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite circulation: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    function pct(n, d) { return d ? (n / d) * 100 : 0; }

    /**
     * Duplication per decade, as a share of that decade's scanned
     * articles rather than a count.
     *
     * A share, because the corpus grows steadily: raw counts would peak
     * wherever the dossier is largest and report corpus growth under
     * another name — the same reasoning that made the arenas view use
     * shares. The share is what can be laid beside the timeline's
     * Ivorian 1993–2001 ridge and answer whether it is many voices or
     * one text moving between titles.
     */
    function decadeOption(bundle) {
        var byDecade = bundle.by_decade || {};
        var decades = Object.keys(byDecade).sort();
        if (!decades.length) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var R = ns.responsive;
        var option = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 56, top: 24, bottom: 44 })
                : { left: 56, right: 24, top: 24, bottom: 44, containLabel: true },
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var p = params[0];
                    return '<strong>' + P.escapeHtml(p.axisValue) + '</strong><br>'
                        + P.t('laicite.circulation_decade_tooltip', {
                            count: P.formatNumber(byDecade[p.axisValue] || 0)
                        });
                }
            },
            xAxis: { type: 'category', data: decades },
            yAxis: {
                type: 'value',
                name: P.t('laicite.circulation_axis'),
                nameLocation: 'end',
                nameGap: 12
            },
            series: [{
                type: 'bar',
                itemStyle: { color: palette[0] },
                data: decades.map(function (d) { return byDecade[d] || 0; })
            }]
        };
        return R && R.withMedia ? R.withMedia(option, {}) : option;
    }

    /** The outlet pairs that share copy most often. */
    function buildLinkList(bundle) {
        var links = (bundle.links || []).slice(0, 15);
        var wrap = P.el('div', 'iwac-vis-laicite-circ-links');
        if (!links.length) return wrap;
        wrap.appendChild(P.el('h5', null, P.t('laicite.circulation_links_title')));
        var list = P.el('ul', 'iwac-vis-laicite-circ-link-list');
        links.forEach(function (row) {
            var li = P.el('li', 'iwac-vis-laicite-circ-link');
            li.appendChild(P.el('span', 'iwac-vis-laicite-circ-link-pair',
                row[0] + ' ⇄ ' + row[1]));
            li.appendChild(P.el('span', 'iwac-vis-laicite-circ-link-n',
                P.t('laicite.circulation_pairs_n', {
                    count: P.formatNumber(row[2])
                })));
            list.appendChild(li);
        });
        wrap.appendChild(list);
        return wrap;
    }

    /**
     * The individual pairs. Shown, not just counted: a near-duplicate
     * claim is checkable only if the reader can open both sides and look.
     */
    function buildPairList(bundle, siteBase) {
        var pairs = bundle.pairs || [];
        var wrap = P.el('div', 'iwac-vis-laicite-circ-pairs');
        if (!pairs.length) return wrap;
        wrap.appendChild(P.el('h5', null, P.t('laicite.circulation_pairs_title')));
        wrap.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.circulation_pairs_desc', {
                listed: P.formatNumber(bundle.listed || pairs.length),
                total: P.formatNumber(bundle.total_pairs || pairs.length)
            })));

        var list = P.el('ul', 'iwac-vis-laicite-circ-pair-list');
        pairs.forEach(function (pair) {
            var li = P.el('li', 'iwac-vis-laicite-circ-pair');
            li.appendChild(P.el('span', 'iwac-vis-laicite-circ-sim',
                P.t('laicite.circulation_similarity', {
                    value: (pair.similarity * 100).toFixed(1)
                })));
            ['a', 'b'].forEach(function (side) {
                var item = pair[side] || {};
                var row = P.el('div', 'iwac-vis-laicite-circ-side');
                var title = item.title || '';
                if (siteBase && item.o_id) {
                    var link = P.el('a', 'iwac-vis-laicite-circ-title', title);
                    link.href = siteBase + '/item/' + item.o_id;
                    row.appendChild(link);
                } else {
                    row.appendChild(P.el('span', 'iwac-vis-laicite-circ-title', title));
                }
                var meta = [item.newspaper, item.year ? String(item.year) : '']
                    .filter(Boolean).join(' · ');
                if (meta) row.appendChild(P.el('span', 'iwac-vis-laicite-circ-meta', meta));
                li.appendChild(row);
            });
            list.appendChild(li);
        });
        wrap.appendChild(list);
        return wrap;
    }

    /**
     * @param {Object} cfg {bundle, siteBase}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildCirculation = function (cfg) {
        var bundle = cfg.bundle || {};
        var root = P.el('div', 'iwac-vis-laicite-circulation');
        var mounts = [];

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.circulation_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.circulation_desc')));

        var scanned = bundle.scanned || 0;
        var reprinted = bundle.reprinted_items || 0;

        if (!scanned) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        // Headline first: one number that answers the question, with both
        // sides of the fraction on screen so the share is checkable.
        panel.appendChild(P.buildSummaryCards([
            { value: reprinted, labelKey: 'laicite.circulation_kpi_items' },
            { value: scanned, labelKey: 'laicite.circulation_kpi_scanned' },
            { value: pct(reprinted, scanned).toFixed(1) + '%', text: true,
              labelKey: 'laicite.circulation_kpi_share' },
            { value: bundle.total_pairs || 0, labelKey: 'laicite.circulation_kpi_pairs' }
        ]));

        // The floor and its blind spot, stated where the numbers are —
        // this counts only pairs where BOTH copies made the dossier, so
        // it is a floor and never a census.
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc iwac-vis-laicite-circ-note',
            P.t('laicite.circulation_note', {
                threshold: ((bundle.threshold || 0) * 100).toFixed(0)
            })));

        if (!reprinted) {
            // A real and reportable answer, not an empty state: this
            // coverage is not syndicated copy.
            panel.appendChild(P.el('p', 'iwac-vis-laicite-circ-none',
                P.t('laicite.circulation_none')));
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        root.appendChild(panel);

        var decadePanel = P.buildPanel('iwac-vis-panel iwac-vis-laicite-circ-decade',
            P.t('laicite.circulation_decade_title'),
            P.t('laicite.circulation_decade_desc'));
        root.appendChild(decadePanel.panel);
        mounts.push(function () {
            ns.registerChart(decadePanel.chart, function (el, instance) {
                instance.setOption(decadeOption(bundle), { notMerge: true });
            });
        });

        var listPanel = P.el('div', 'iwac-vis-panel');
        listPanel.appendChild(buildLinkList(bundle));
        listPanel.appendChild(buildPairList(bundle, cfg.siteBase));
        root.appendChild(listPanel);

        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };
})();
