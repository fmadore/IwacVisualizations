/**
 * IWAC Visualizations — Laïcité block: Bibliography (issue #14, view 11).
 *
 * The scholarship on laïcité held in the collection, closing the loop
 * between what the sources said and what has been written about them.
 *
 * Kept on its own axis and never folded into the timeline: a reference is
 * dated by when the ANALYSIS was published, not by the period it analyses,
 * so a 2022 monograph about the 1990s belongs to neither decade in the way
 * a press article does. That is also why scholarship is absent from every
 * temporal facet elsewhere in the block, and the note under the chart says
 * so rather than leaving the reader to discover the asymmetry.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite references: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    var PAGE_SIZE = 25;

    /** Work types offered by the filter, most common first. */
    L.referenceTypes = function (bundle) {
        return Object.keys((bundle || {}).by_type || {});
    };

    function filtered(bundle, state) {
        var items = (bundle || {}).items || [];
        if (!state.refType) return items;
        return items.filter(function (r) { return r.type === state.refType; });
    }

    /**
     * @param {Object} cfg {bundle, state, siteBase}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildReferences = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-references');
        var mounts = [];

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.references_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.references_desc')));

        if (!bundle || !(bundle.items || []).length) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var chart = P.el('div', 'iwac-vis-chart iwac-vis-laicite-refs-chart');
        panel.appendChild(chart);
        mounts.push(function () {
            ns.registerChart(chart, function (el, instance) {
                instance.setOption(yearsOption(bundle), { notMerge: true });
            });
        });
        panel.appendChild(P.el('p', 'iwac-vis-laicite-caveat',
            P.t('laicite.references_note')));

        panel.appendChild(buildBreakdown(bundle));
        panel.appendChild(buildWorkList(bundle, cfg));

        root.appendChild(panel);
        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };

    /** Publication years of the scholarship — a growth curve, not coverage. */
    function yearsOption(bundle) {
        var years = bundle.years || [];
        if (!years.length) return P.emptyChartOption();
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var R = ns.responsive;
        var base = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 56, top: 32, bottom: 52 })
                : { left: 56, right: 24, top: 32, bottom: 52, containLabel: true },
            tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: years.map(String),
                name: P.t('laicite.references_year_axis'),
                nameLocation: 'middle',
                nameGap: 30,
                axisLabel: { rotate: years.length > 20 ? 45 : 0 }
            },
            yAxis: Object.assign({ type: 'value' },
                (ns.chartOptions && ns.chartOptions._valueAxisName)
                    ? ns.chartOptions._valueAxisName(P.t('laicite.references_axis'))
                    : { name: P.t('laicite.references_axis') }),
            dataZoom: (ns.chartOptions && ns.chartOptions._dataZoom)
                ? ns.chartOptions._dataZoom(years.length, { threshold: 30 })
                : [],
            series: [{
                type: 'bar',
                name: P.t('laicite.references_axis'),
                itemStyle: { color: palette[0] },
                data: bundle.by_year || []
            }]
        };
        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: years.length > 30 }))
            : base;
    }

    /** Type / language / country counts, as chip rows. */
    function buildBreakdown(bundle) {
        var wrap = P.el('div', 'iwac-vis-laicite-breakdown');
        [
            { key: 'laicite.references_by_type', data: bundle.by_type },
            { key: 'laicite.references_by_language', data: bundle.by_language },
            { key: 'laicite.references_by_country', data: bundle.by_country }
        ].forEach(function (group) {
            var keys = Object.keys(group.data || {});
            if (!keys.length) return;
            var row = P.el('div', 'iwac-vis-laicite-breakdown-row');
            row.appendChild(P.el('span', 'iwac-vis-laicite-breakdown-label',
                P.t(group.key)));
            var chips = P.el('span', 'iwac-vis-laicite-breakdown-chips');
            keys.forEach(function (k) {
                chips.appendChild(L.chip(k + ' ' + P.formatNumber(group.data[k]),
                    'is-count'));
            });
            row.appendChild(chips);
            wrap.appendChild(row);
        });
        return wrap;
    }

    /** The works themselves, paginated, newest first. */
    function buildWorkList(bundle, cfg) {
        var siteBase = cfg.siteBase || '';
        var items = filtered(bundle, cfg.state);
        var host = P.el('div', 'iwac-vis-laicite-works');
        var page = 0;

        var count = P.el('p', 'iwac-vis-laicite-works-count');
        var list = P.el('ol', 'iwac-vis-laicite-work-list');
        var pagerHost = P.el('div');
        host.appendChild(count);
        host.appendChild(list);
        host.appendChild(pagerHost);

        function totalPages() {
            return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        }

        function paint() {
            count.textContent = P.t('laicite.references_count',
                { count: P.formatNumber(items.length) });
            list.innerHTML = '';
            list.setAttribute('start', String(page * PAGE_SIZE + 1));
            items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                .forEach(function (work) {
                    list.appendChild(buildWork(work, siteBase));
                });
        }

        if (!items.length) {
            host.appendChild(P.buildEmptyState('laicite.references_empty'));
            return host;
        }
        paint();
        if (totalPages() > 1) {
            var pager = P.buildPagination({
                currentPage: page,
                totalPages: totalPages(),
                onChange: function (next) {
                    page = next;
                    paint();
                    pager.update({ currentPage: page, totalPages: totalPages() });
                }
            });
            pagerHost.appendChild(pager.root);
        }
        return host;
    }

    function buildWork(work, siteBase) {
        var li = P.el('li', 'iwac-vis-laicite-work');

        var title;
        if (siteBase && work.o_id) {
            title = P.el('a', 'iwac-vis-laicite-work-title', work.title);
            title.href = siteBase + '/item/' + work.o_id;
        } else {
            title = P.el('span', 'iwac-vis-laicite-work-title', work.title);
        }
        li.appendChild(title);

        var meta = [];
        if (work.author) meta.push(work.author);
        if (work.year) meta.push(String(work.year));
        if (work.type) meta.push(work.type);
        if ((work.languages || []).length) meta.push(work.languages.join(', '));
        li.appendChild(P.el('p', 'iwac-vis-laicite-work-meta', meta.join(' · ')));

        var flags = P.el('p', 'iwac-vis-laicite-work-flags');
        if (work.tagged) {
            flags.appendChild(L.chip(P.t('laicite.doc_tagged'), 'is-tagged'));
        }
        if (work.occurrences) {
            flags.appendChild(L.chip(
                P.t('laicite.occurrences') + ' ' + P.formatNumber(work.occurrences),
                'is-count'));
        }
        (work.countries || []).forEach(function (country) {
            flags.appendChild(L.chip(country, 'is-country'));
        });
        if (flags.childNodes.length) li.appendChild(flags);
        return li;
    }
})();
