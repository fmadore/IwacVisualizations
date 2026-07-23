/**
 * IWAC Visualizations — Islamic Organisations Co-occurrence block (orchestrator)
 *
 * Term × term co-occurrence heatmap for a selectable Islamic organisation
 * (GitHub issue #1). Loads `org-cooccurrence.json` (built by
 * `scripts/generate_org_cooccurrence.py` from a ±50-token sliding window
 * around each organisation's curated surface forms) and renders:
 *
 *   - metric cards — matching articles, distinct context words, top pair
 *     count, coverage span
 *   - organisation select + axis-sort toggle (frequency | alphabetical)
 *   - the matrix via the shared C.heatmapMatrix builder (same pixels as
 *     the Periodicals holdings matrix — no forked heatmap implementation)
 *   - a header link to the organisation's IWAC authority record
 *
 * Load order: after shared/panels.js + shared/chart-options*.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis org-cooccurrence: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading organisation co-occurrences': 'Loading organisation co-occurrences',
            'orgcooc.title':        'Islamic organisations — discursive neighbourhoods',
            'orgcooc.description':  'Which ideas cluster around an organisation in the West African press. For the chosen organisation we gather the words that appear near its name (within about {window} words), then count how often each pair of those words turns up together in the same article. Darker cells are pairs that recur across many articles — the recurring threads in how the press writes about the group. The diagonal is blank, since pairing a word with itself says nothing.',
            'orgcooc.organisation': 'Organisation',
            'orgcooc.sort':         'Sort',
            'orgcooc.sort_freq':    'Frequency',
            'orgcooc.sort_alpha':   'Alphabetical',
            'orgcooc.card_articles': 'Matching articles',
            'orgcooc.card_vocab':    'Distinct context words',
            'orgcooc.card_maxpair':  'Strongest pair (articles)',
            'orgcooc.card_span':     'Coverage span',
            'orgcooc.matrix_title':  'Co-occurrence matrix — {org}',
            'orgcooc.pair_tooltip':  '{a} × {b}<br>{count} shared articles',
            'orgcooc.term_total':    '{term}: in {count} matching articles',
            'orgcooc.view_record':   'View authority record'
        });
        ns.addTranslations('fr', {
            'Loading organisation co-occurrences': 'Chargement des co-occurrences',
            'orgcooc.title':        'Organisations islamiques — voisinages discursifs',
            'orgcooc.description':  'Quelles idées se regroupent autour d’une organisation dans la presse ouest-africaine. Pour l’organisation choisie, on rassemble les mots qui apparaissent près de son nom (à environ {window} mots), puis on compte combien de fois chaque paire de ces mots se retrouve ensemble dans un même article. Les cellules plus sombres sont les paires qui reviennent dans de nombreux articles — les fils récurrents de la manière dont la presse traite le groupe. La diagonale est vide, car associer un mot à lui-même n’apporte rien.',
            'orgcooc.organisation': 'Organisation',
            'orgcooc.sort':         'Tri',
            'orgcooc.sort_freq':    'Fréquence',
            'orgcooc.sort_alpha':   'Alphabétique',
            'orgcooc.card_articles': 'Articles correspondants',
            'orgcooc.card_vocab':    'Mots de contexte distincts',
            'orgcooc.card_maxpair':  'Paire la plus forte (articles)',
            'orgcooc.card_span':     'Période couverte',
            'orgcooc.matrix_title':  'Matrice de co-occurrence — {org}',
            'orgcooc.pair_tooltip':  '{a} × {b}<br>{count} articles partagés',
            'orgcooc.term_total':    '{term} : dans {count} articles correspondants',
            'orgcooc.view_record':   'Voir la notice d’autorité'
        });
    }

    function initBlock(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };
        P.fetchJSON(ctx.basePath + '/files/iwac-visualizations/org-cooccurrence.json')
            .then(function (data) { buildLayout(container, data, ctx); })
            .catch(function (err) {
                console.error('IWACVis org-cooccurrence:', err);
                container.innerHTML = '';
                container.appendChild(P.buildFetchErrorState(err));
            });
    }

    function buildLayout(container, data, ctx) {
        var orgs = data.orgs || [];
        var matrices = data.matrices || {};
        if (!orgs.length) {
            container.innerHTML = '';
            container.appendChild(P.buildEmptyState());
            return;
        }

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-orgcooc-root');
        container.appendChild(root);

        var header = P.el('div', 'iwac-vis-block-header iwac-vis-orgcooc-header');
        header.appendChild(P.el('h3', 'iwac-vis-block-header__title', P.t('orgcooc.title')));
        header.appendChild(P.el('p', 'iwac-vis-block-header__desc',
            P.t('orgcooc.description', { window: data.window_size || 50 })));
        root.appendChild(header);

        var state = { orgId: orgs[0].id, sort: 'freq' };

        // Controls: organisation select + sort select
        var controls = P.el('div', 'iwac-vis-aside iwac-vis-orgcooc-controls');
        controls.appendChild(buildSelect(
            P.t('orgcooc.organisation'),
            orgs.map(function (o) {
                return {
                    value: o.id,
                    label: o.acronym ? o.name + ' (' + o.acronym + ')' : o.name
                };
            }),
            state.orgId,
            function (value) { state.orgId = value; update(); }
        ));
        controls.appendChild(buildSelect(
            P.t('orgcooc.sort'),
            [
                { value: 'freq',  label: P.t('orgcooc.sort_freq') },
                { value: 'alpha', label: P.t('orgcooc.sort_alpha') }
            ],
            state.sort,
            function (value) { state.sort = value; update(); }
        ));
        root.appendChild(controls);

        // Metric cards
        var cardsHost = P.el('div');
        root.appendChild(cardsHost);

        // Chart panel
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-orgcooc-panel');
        var panelHeader = P.el('div', 'iwac-vis-orgcooc-panel-header');
        var panelTitle = P.el('h4', 'iwac-vis-orgcooc-panel-title');
        var recordLink = P.el('a', 'iwac-vis-orgcooc-record-link', P.t('orgcooc.view_record'));
        panelHeader.appendChild(panelTitle);
        panelHeader.appendChild(recordLink);
        panel.appendChild(panelHeader);
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-orgcooc-chart');
        panel.appendChild(chartEl);
        root.appendChild(panel);

        function currentOrg() {
            for (var i = 0; i < orgs.length; i++) {
                if (orgs[i].id === state.orgId) return orgs[i];
            }
            return orgs[0];
        }

        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            update();
        });

        function update() {
            var org = currentOrg();
            var m = matrices[org.id] || { terms: [], matrix: [], term_counts: {} };

            // Metric cards
            cardsHost.innerHTML = '';
            cardsHost.appendChild(P.buildSummaryCards([
                { value: org.total_articles,  labelKey: 'orgcooc.card_articles' },
                { value: org.vocabulary_size, labelKey: 'orgcooc.card_vocab' },
                { value: m.max_cooccurrence,  labelKey: 'orgcooc.card_maxpair' }
            ]));
            if (org.year_range && org.year_range.length === 2) {
                var span = P.el('p', 'iwac-vis-overview-subtitle',
                    P.t('orgcooc.card_span') + ': ' + org.year_range[0]
                        + ' – ' + org.year_range[1]);
                cardsHost.appendChild(span);
            }

            panelTitle.textContent = P.t('orgcooc.matrix_title', {
                org: org.acronym || org.name
            });
            if (org.o_id && ctx.siteBase) {
                recordLink.href = ctx.siteBase + '/item/' + org.o_id;
                recordLink.style.display = '';
            } else {
                recordLink.style.display = 'none';
            }

            if (!currentInstance || currentInstance.isDisposed()) return;
            currentInstance.setOption(buildMatrixOption(m, org), {
                notMerge: true, lazyUpdate: true
            });
        }

        function buildMatrixOption(m, org) {
            var terms = (m.terms || []).slice();
            if (!terms.length) return P.emptyChartOption();
            var counts = m.term_counts || {};

            // Axis ordering. The generator emits frequency order; the
            // alphabetical toggle re-permutes both axes AND the matrix.
            var order = terms.map(function (_, i) { return i; });
            if (state.sort === 'alpha') {
                order.sort(function (a, b) {
                    return terms[a].localeCompare(terms[b], 'fr');
                });
            }
            var labels = order.map(function (i) { return terms[i]; });

            var cells = [];
            for (var x = 0; x < order.length; x++) {
                for (var y = 0; y < order.length; y++) {
                    if (x === y) continue;
                    var v = (m.matrix[order[x]] || [])[order[y]] || 0;
                    if (v > 0) cells.push([x, y, v]);
                }
            }
            if (!cells.length) return P.emptyChartOption();

            return C.heatmapMatrix(
                { xLabels: labels, yLabels: labels, cells: cells },
                {
                    visualMax: m.max_cooccurrence || undefined,
                    yLabelWidth: 110,
                    tooltipFormatter: function (p) {
                        var v = p.value || [];
                        return P.t('orgcooc.pair_tooltip', {
                            a: P.escapeHtml(String(labels[v[0]] || '')),
                            b: P.escapeHtml(String(labels[v[1]] || '')),
                            count: P.formatNumber(v[2] || 0)
                        }) + '<br>' + P.t('orgcooc.term_total', {
                            term: P.escapeHtml(String(labels[v[0]] || '')),
                            count: P.formatNumber(counts[labels[v[0]]] || 0)
                        });
                    }
                }
            );
        }
    }

    /** Thin delegate to the shared control, pinning this block's classes. */
    function buildSelect(labelText, options, current, onChange) {
        return P.buildSelectControl({
            label: labelText,
            options: options,
            current: current,
            onChange: onChange,
            groupClass: 'iwac-vis-orgcooc-select-group',
            labelClass: 'iwac-vis-orgcooc-label',
            selectClass: 'iwac-vis-orgcooc-select',
            idPrefix: 'iwac-vis-orgcooc-'
        });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis org-cooccurrence: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-orgcooc');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
