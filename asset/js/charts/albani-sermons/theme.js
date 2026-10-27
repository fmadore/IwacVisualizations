/**
 * IWAC Visualizations — Albani Zaria sermons, sections 3 and 4: one
 * instrument, two lexicons (youth; democracy and politics).
 *
 * The question each section answers is "which words travel with this
 * vocabulary in these sermons", and the panels follow the order a reader
 * checks it in: the lexicon and its counts (what is being looked for, and
 * how often it is found), where it concentrates by recording, the words
 * near it, the graph of those relations, and the passages themselves.
 *
 * Bundles: lexicon.json and metadata.json arrive with the block; the
 * collocates, the network and the theme's concordance are fetched when the
 * section first nears the viewport.
 *
 * Depends on: albani-sermons/helpers.js, shared/table.js, shared/concordance.js,
 * shared/graph-panel.js (P.mountForceGraph, the `d3` need).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons;

    var TOP_RECORDINGS = 20;
    var MIN_NETWORK_HITS = 5;

    /* ----------------------------------------------------------------- */
    /*  The lexicon table                                                 */
    /* ----------------------------------------------------------------- */

    function lexiconPanel(section, theme, lexicon, store) {
        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('albani_lexicon_table'), P.t('albani_lexicon_table_desc'),
            { key: 'albani-' + theme + '-lexicon' });
        panel.chart.classList.add('iwac-vis-albani__table-host');
        section.appendChild(panel.panel);
        var entries = (lexicon.entries || []).filter(function (e) { return e.theme === theme; });
        var order = (((lexicon.themes || {})[theme] || {}).categories || []).map(function (c) { return c.id; });

        var table = P.buildTable({
            columns: [
                { key: 'term', label: P.t('albani_col_term'), card: 'title',
                  render: function (row, td) {
                      var cell = P.el('span', 'iwac-vis-albani__term');
                      cell.appendChild(P.el('span', 'iwac-vis-albani__hausa', row.term));
                      if (row.ambiguous) {
                          cell.appendChild(A.badge(P.t('albani_ambiguous'), P.t('albani_ambiguous_hint')));
                      }
                      if (row.excluded) {
                          cell.appendChild(P.el('span', 'iwac-vis-albani__excluded',
                              P.t('albani_excluded', { count: row.excluded })));
                      }
                      td.appendChild(cell);
                  } },
                { key: 'gloss', label: P.t('albani_col_gloss'), card: 'meta' },
                { key: 'category', label: P.t('albani_col_category'), card: 'badge' },
                { key: 'n', label: P.t('albani_col_count'), card: 'row' },
                { key: 's', label: P.t('albani_col_segments'), card: 'row' },
                { key: 'r', label: P.t('albani_col_recordings'), card: 'row' },
                { key: 'forms', label: P.t('albani_col_forms'), card: 'meta' }
            ],
            rows: [],
            pageSize: 12
        });
        panel.chart.appendChild(table.root);
        var missing = A.note('', 'iwac-vis-albani__missing');
        panel.panel.appendChild(missing);

        function refresh() {
            var scope = store.get('scope');
            var found = entries.filter(function (e) { return e.n[scope] > 0; });
            found.sort(function (a, b) {
                return (order.indexOf(a.category) - order.indexOf(b.category)) || (b.n[scope] - a.n[scope]);
            });
            table.update(found.map(function (e) {
                return {
                    term: e.display,
                    ambiguous: e.ambiguous,
                    excluded: e.excluded,
                    gloss: A.label(e, 'gloss'),
                    category: A.categoryLabel(lexicon, theme, e.category),
                    n: P.formatNumber(e.n[scope]),
                    s: P.formatNumber(e.s[scope]),
                    r: P.formatNumber(e.r[scope]),
                    forms: (e.forms || []).join(', ')
                };
            }), 0);
            var absent = entries.filter(function (e) { return !e.n[scope]; })
                .map(function (e) { return e.display; });
            missing.textContent = absent.length ? P.t('albani_not_found', { terms: absent.join(', ') }) : '';
            missing.hidden = !absent.length;
        }
        refresh();
        store.subscribe(refresh, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  Per-recording intensity                                           */
    /* ----------------------------------------------------------------- */

    function intensityPanel(section, theme, lexicon, metadata, store) {
        var titles = A.recordingsById(metadata);
        var panel = A.chartPanel(section, P.t('albani_intensity'), P.t('albani_intensity_desc'),
            function (built) {
                var rows = ((lexicon.by_recording || {})[store.get('scope')] || [])
                    .filter(function (r) { return r.w > 0; })
                    .map(function (r) {
                        var n = (r.themes || {})[theme] || 0;
                        return {
                            name: (titles[r.o] || {}).t || r.o,
                            count: A.per10k(n, r.w),
                            raw: n,
                            words: r.w,
                            o_id: r.o
                        };
                    })
                    .filter(function (r) { return r.raw > 0; })
                    .sort(function (a, b) { return b.count - a.count; })
                    .slice(0, TOP_RECORDINGS);
                A.sizeFor(built.chart, rows.length);
                var option = C.horizontalBar(rows, {
                    nameKey: 'name', valueKey: 'count', maxLabelLength: 34, itemFields: ['o_id'],
                    valueFormatter: function (v) { return P.formatDecimal(v, 1); },
                    tooltipFormatter: function (p) {
                        var row = rows[p.dataIndex] || {};
                        return '<strong>' + P.escapeHtml(row.name || '') + '</strong><br>'
                            + P.escapeHtml(P.formatDecimal(row.count, 1) + ' ' + P.t('albani_per_10k')) + '<br>'
                            + P.escapeHtml(P.t('albani_intensity_tooltip', {
                                count: row.raw, words: P.formatNumber(row.words) }));
                    }
                });
                return option;
            }, { key: 'albani-' + theme + '-intensity' });
        store.subscribe(panel.redraw, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  Collocates                                                        */
    /* ----------------------------------------------------------------- */

    function collocatesPanel(host, theme, lexicon, collocates, store) {
        var cats = ((lexicon.themes || {})[theme] || {}).categories || [];
        var state = { slice: 'pooled' };
        var options = [{ value: 'pooled', label: P.t('albani_collocates_pooled') }];
        cats.forEach(function (c) {
            var any = A.SCOPES.some(function (s) {
                var payload = ((((collocates.scopes || {})[s] || {})[theme] || {})[c.id]) || {};
                return (payload.terms || []).length > 0;
            });
            if (any) options.push({ value: c.id, label: A.label(c, 'label') });
        });
        var picker = A.select(P.t('albani_collocates_for'), options, state.slice, function (value) {
            state.slice = value;
            panel.redraw();
        }, 'albani-' + theme + '-collocates');
        var empty = A.note(P.t('albani_collocates_none'));
        empty.hidden = true;

        var panel = A.chartPanel(host, P.t('albani_collocates'),
            P.t('albani_collocates_desc', {
                window: collocates.window,
                segments: collocates.min_segments,
                recordings: collocates.min_recordings
            }),
            function (built) {
                var payload = ((((collocates.scopes || {})[store.get('scope')] || {})[theme] || {})[state.slice]) || {};
                var terms = (payload.terms || []).slice(0, 25);
                empty.hidden = terms.length > 0;
                if (!terms.length) return null;
                A.sizeFor(built.chart, terms.length);
                return A.logRatioOption(terms, {
                    axis: P.t('albani_collocates_axis'),
                    tooltip: function (term) {
                        var line = P.t('albani_collocates_tooltip', {
                            count: term.n, segments: P.formatNumber(term.s), recordings: P.formatNumber(term.r) });
                        if (term.ratio == null) line += '<br>' + P.t('albani_collocates_only_near');
                        if (term.lex) line += '<br>' + P.t('albani_collocates_lex');
                        return line;
                    }
                });
            }, { wide: true, key: 'albani-' + theme + '-collocates', before: [picker, empty] });
        store.subscribe(panel.redraw, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  Network                                                           */
    /* ----------------------------------------------------------------- */

    function networkPanel(host, theme, lexicon, network, collocates, store) {
        var cats = ((lexicon.themes || {})[theme] || {}).categories || [];
        var categories = cats.map(function (c) { return { name: A.label(c, 'label') }; });
        categories.push({ name: P.t('albani_node_collocate') });
        var catIndex = {};
        cats.forEach(function (c, i) { catIndex[c.id] = i; });
        var collocateIndex = categories.length - 1;

        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('albani_network'),
            P.t('albani_network_desc', { min: MIN_NETWORK_HITS, window: network.window || collocates.window }),
            { key: 'albani-' + theme + '-network' });
        host.appendChild(panel.panel);

        function graphFor(scope) {
            var g = ((network.scopes || {})[scope] || {})[theme] || { nodes: [], links: [] };
            var max = 1;
            g.nodes.forEach(function (n) { if (n.n > max) max = n.n; });
            return {
                nodes: g.nodes.map(function (n) {
                    return {
                        id: n.id,
                        name: n.name,
                        category: n.kind === 'term' ? (catIndex[n.category] || 0) : collocateIndex,
                        size: 6 + 18 * Math.sqrt(n.n / max),
                        data: n
                    };
                }),
                links: g.links.map(function (l) {
                    return { source: l.source, target: l.target, weight: l.n, name: P.formatNumber(l.n) };
                })
            };
        }

        var all = {};
        A.SCOPES.forEach(function (s) {
            graphFor(s).nodes.forEach(function (n) { all[n.id] = n; });
        });
        var mounted = P.mountForceGraph(panel, {
            nodes: Object.keys(all).map(function (k) { return all[k]; }),
            categories: categories,
            seed: theme === 'youth' ? 31 : 37,
            colorOf: function (i) {
                if (i === collocateIndex) {
                    return ((ns.getChartTokens && ns.getChartTokens()) || {}).muted;
                }
                return ns.getSeriesColor(i);
            },
            categoryName: function (node) { return (categories[node.category] || {}).name || ''; },
            tooltip: function (node, link) {
                var rows = [];
                if (node) {
                    rows.push(P.el('strong', null, node.name));
                    rows.push(P.el('div', null, (categories[node.category] || {}).name || ''));
                    rows.push(P.el('div', null, P.t('albani_network_occurrences') + ': '
                        + P.formatNumber((node.data || {}).n || 0)));
                } else if (link) {
                    rows.push(P.el('strong', null, link.source.name + ' ↔ ' + link.target.name));
                    if (link.name) rows.push(P.el('div', null, link.name));
                }
                return rows;
            },
            cardRows: function (node) {
                var d = node.data || {};
                var rows = [{ label: P.t('albani_network_occurrences'), value: P.formatNumber(d.n || 0) }];
                if (d.lr != null) rows.push({ label: P.t('albani_network_ratio'), value: '×' + P.formatDecimal(Math.pow(2, d.lr), 1) });
                return rows;
            },
            announce: function (node) {
                return node.name + '. ' + ((categories[node.category] || {}).name || '') + '. '
                    + P.connectionsLabel(node.deg || 0);
            },
            ariaLabel: P.t('albani_network'),
            downloadName: 'albani-' + theme + '-network'
        });
        if (!mounted) return;
        function show() { mounted.setGraph(graphFor(store.get('scope')), true); }
        show();
        store.subscribe(show, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  Concordance                                                       */
    /* ----------------------------------------------------------------- */

    function concordancePanel(host, theme, lexicon, conc, store, ctx) {
        var byId = A.entriesById(lexicon);
        var withheld = 0;
        Object.keys(conc.counts || {}).forEach(function (k) { withheld += conc.counts[k].withheld || 0; });
        var desc = P.t('albani_kwic_desc');
        if (withheld) desc += ' ' + P.t('albani_kwic_withheld', { count: withheld });
        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('albani_kwic'), desc,
            { key: 'albani-' + theme + '-kwic' });
        host.appendChild(panel.panel);

        var state = { term: '', query: '' };
        var present = {};
        (conc.rows || []).forEach(function (r) { present[r.e] = true; });
        var options = [{ value: '', label: P.t('albani_kwic_all_terms') }];
        Object.keys(present).sort(function (a, b) {
            return String((byId[a] || {}).display || a).localeCompare(String((byId[b] || {}).display || b));
        }).forEach(function (id) {
            options.push({ value: id, label: (byId[id] || {}).display || id });
        });
        var controls = P.el('div', 'iwac-vis-albani__controls');
        controls.appendChild(A.select(P.t('albani_kwic_term'), options, '', function (v) {
            state.term = v;
            refresh();
        }, 'albani-' + theme + '-kwic-term'));
        var search = P.el('input', 'iwac-vis-control iwac-vis-albani__search');
        search.type = 'search';
        search.setAttribute('aria-label', P.t('albani_kwic_filter'));
        search.placeholder = P.t('albani_kwic_filter');
        search.addEventListener('input', function () {
            state.query = search.value.trim();
            refresh();
        });
        controls.appendChild(search);
        var counter = P.el('p', 'iwac-vis-albani__count');
        controls.appendChild(counter);
        panel.panel.insertBefore(controls, panel.chart);

        var kwic = P.buildConcordance({
            rows: [],
            items: conc.items || [],
            pageSize: 20,
            emptyKey: 'albani_kwic_empty',
            className: 'iwac-vis-albani__kwic',
            renderMeta: function (row, item) {
                var meta = P.el('p', 'iwac-vis-kwic-meta');
                var title = P.el('a', 'iwac-vis-kwic-title', item.t || item.o);
                title.href = A.itemHref(ctx, item.o, item.u);
                meta.appendChild(title);
                if (item.y) meta.appendChild(P.el('span', 'iwac-vis-kwic-source', ' · ' + item.y));
                var win = P.el('a', 'iwac-vis-albani__window',
                    P.t('albani_kwic_window', { part: row.p, window: A.windowLabel(row.s, row.x) }));
                win.href = A.windowHref(ctx, item, row.p, row.s);
                win.title = P.t('albani_kwic_window_hint');
                meta.appendChild(P.el('span', 'iwac-vis-kwic-sep', ' · '));
                meta.appendChild(win);
                meta.appendChild(P.el('span', 'iwac-vis-kwic-frame', (byId[row.e] || {}).display || row.e));
                if (row.md === 'exchange') {
                    meta.appendChild(A.badge(P.t('albani_kwic_exchange'), P.t('albani_kwic_exchange_hint')));
                }
                return meta;
            }
        });
        panel.chart.classList.add('iwac-vis-albani__kwic-host');
        panel.chart.appendChild(kwic.root);

        function refresh() {
            var monologue = store.get('scope') === 'monologue';
            var all = (conc.rows || []).filter(function (r) { return !r.en; });
            var rows = all.filter(function (r) {
                if (monologue && r.md === 'exchange') return false;
                if (state.term && r.e !== state.term) return false;
                return P.concordanceMatches(r, state.query);
            });
            counter.textContent = P.t('albani_kwic_count', {
                shown: P.formatNumber(rows.length), total: P.formatNumber(all.length) });
            kwic.update(rows);
        }
        refresh();
        store.subscribe(refresh, { keys: ['scope'] });
    }

    /* ----------------------------------------------------------------- */
    /*  The section                                                       */
    /* ----------------------------------------------------------------- */

    A.renderTheme = function (section, theme, bundle, store, fetch, ctx) {
        var lexicon = bundle.lexicon || {};
        lexiconPanel(section, theme, lexicon, store);
        intensityPanel(section, theme, lexicon, bundle.metadata, store);

        var deferred = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(deferred);
        A.lazy(deferred, function () {
            return Promise.all([
                fetch('collocates.json'),
                fetch('network.json'),
                fetch('concordance-' + theme + '.json')
            ]);
        }, function (results) {
            collocatesPanel(deferred, theme, lexicon, results[0], store);
            networkPanel(deferred, theme, lexicon, results[1], results[0], store);
            concordancePanel(deferred, theme, lexicon, results[2], store, ctx);
        });
    };
})();
