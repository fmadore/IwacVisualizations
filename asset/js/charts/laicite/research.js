/** Source coverage and inspectable annual numerators/denominators. */
(function () {
    'use strict';
    var ns = window.IWACVis;
    if (!ns || !ns.panels) return;
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    function table(headers, rows) {
        var wrap = P.el('div', 'iwac-vis-table-wrapper');
        wrap.tabIndex = 0;
        var t = P.el('table', 'iwac-vis-table');
        var head = P.el('thead');
        var tr = P.el('tr');
        headers.forEach(function (h) { var th = P.el('th', 'iwac-vis-table__header', h); th.scope = 'col'; tr.appendChild(th); });
        head.appendChild(tr); t.appendChild(head);
        var body = P.el('tbody');
        rows.forEach(function (r) {
            var row = P.el('tr');
            r.forEach(function (v, i) {
                var cell = P.el(i ? 'td' : 'th', 'iwac-vis-table__cell', String(v));
                cell.setAttribute('data-label', headers[i]);
                if (!i) cell.scope = 'row';
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
        t.appendChild(body); wrap.appendChild(t); return wrap;
    }
    function text(key) { return P.t('laicite.' + key); }
    L.researchTable = table;

    L.buildMatchedSentiment = function (data) {
        var root = P.el('details');
        root.appendChild(P.el('summary', null, text('research_matched')));
        root.appendChild(P.el('p', null, text('research_matched_note')));
        Object.keys(data.matched || {}).forEach(function (prop) {
            var d = data.matched[prop];
            var heading = prop === 'polarite' ? 'polarity' : prop === 'centralite' ? 'centrality' : 'subjectivity';
            root.appendChild(P.el('h5', null, text('research_' + heading)));
            root.appendChild(P.el('p', null, P.t('laicite.research_matched_n', d)));
            root.appendChild(table([text('research_label'), text('research_selected'), text('research_controls')],
                Array.from(new Set(Object.keys(d.dossier).concat(Object.keys(d.weighted_controls)))).sort().map(function (k) {
                    return [P.t(k), d.matched ? (100 * (d.dossier[k] || 0) / d.matched).toFixed(1) + '%' : '—',
                        d.matched ? (100 * (d.weighted_controls[k] || 0) / d.matched).toFixed(1) + '%' : '—'];
                })));
        });
        return root;
    };

    L.buildSourceComparisons = function (siteBase) {
        var root = P.el('section', 'iwac-vis-panel');
        root.appendChild(P.el('h4', null, text('research_cases')));
        ['76294', '11382'].forEach(function (id) {
            var link = P.el('a', null, text('research_case_' + id));
            link.href = siteBase + '/item/' + id;
            root.appendChild(link);
            root.appendChild(P.el('p', null, text('research_case_note_' + id)));
        });
        root.appendChild(P.el('p', 'iwac-vis-panel-desc', text('research_case_limit')));
        return root;
    };

    L.researchSeries = function (bundle, state) {
        var field = state.trendsField || 'fulltext';
        var prefix = state.trendsPrecision || '';
        var groups = {};
        (bundle.cells || []).forEach(function (r) {
            if (r.subset !== (state.trendsSubset || 'articles') || r.country !== (state.trendsCountry || '')
                || (state.trendsOutlet && r.outlet !== state.trendsOutlet) || !r.year) return;
            var c = groups[r.year] = groups[r.year] || { matches: 0, hits: 0, eligible: 0, records: 0 };
            c.matches += r[prefix + field + '_matches'] || 0;
            c.hits += field === 'union' ? (r[prefix + 'title_hits'] || 0) + (r[prefix + 'fulltext_hits'] || 0)
                : r[prefix + field + '_hits'] || 0;
            c.eligible += r[field + '_available'] || 0;
            c.records += r.records;
        });
        var observed = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
        var years = [];
        if (observed.length) for (var y = observed[0]; y <= observed[observed.length - 1]; y++) years.push(y);
        var metric = state.trendsMetric || 'rate';
        return {
            years: years, frames: ['laicite'], label: text('research_' + metric), evidence: groups,
            series: { laicite: years.map(function (year) {
                var r = groups[year];
                if (!r || !r.eligible) return null;
                if (metric === 'rate') return r.eligible < (bundle.minimum_cell || 5)
                    ? null : Math.round(10000 * r.matches / r.eligible) / 100;
                return r[metric];
            }) }
        };
    };

    L.buildTrendEvidence = function (trends, state) {
        var root = P.el('div');
        root.appendChild(P.el('p', 'iwac-vis-panel-desc', text('research_timeline_note')));
        if (!trends || !trends.research) return root;
        var r = L.researchSeries(trends.research, state);
        var details = P.el('details');
        details.appendChild(P.el('summary', null, text('research_inspect')));
        details.appendChild(table([text('research_year'), text('research_matches'), text('research_hits'),
            text('research_eligible'), text('research_records')], r.years.map(function (y) {
            var c = r.evidence[y] || { matches: 0, hits: 0, eligible: 0, records: 0 };
            return [y, c.matches, c.hits, c.eligible, c.records];
        })));
        root.appendChild(details); return root;
    };

    L.buildResearch = function (bundle) {
        var root = P.el('section', 'iwac-vis-panel');
        root.appendChild(P.el('h4', null, text('research_coverage')));
        if (!bundle) { root.appendChild(P.buildNoDataState()); return root; }
        root.appendChild(P.el('p', 'iwac-vis-panel-desc', text('research_coverage_note')));
        var output = P.el('div');
        var country = '';
        var grouped = false;
        var controls = P.el('div', 'iwac-vis-controls-slot');
        var countries = Array.from(new Set(bundle.cells.map(function (r) { return r.country; }).filter(Boolean))).sort();
        controls.appendChild(P.buildSelectControl({
            name: 'coverage-country', idPrefix: 'laicite-coverage-country', label: text('filter_country'),
            options: [{ value: '', label: text('scope_global') }].concat(countries.map(function (c) {
                return { value: c, label: c };
            })), current: '', onChange: function (v) { country = v; draw(); }
        }));
        controls.appendChild(P.buildSelectControl({
            name: 'coverage-period', idPrefix: 'laicite-coverage-period', label: text('research_period'),
            options: [{ value: '', label: text('filter_all') }, { value: 'decade', label: text('research_decade') }],
            current: '', onChange: function (v) { grouped = !!v; draw(); }
        }));
        root.appendChild(controls); root.appendChild(output);
        function draw() {
            output.innerHTML = '';
            var groups = {};
            bundle.cells.filter(function (r) { return r.country === country; }).forEach(function (r) {
                var label = L.subsetLabel(r.subset) + (grouped ? ' · ' + (r.year ? Math.floor(r.year / 10) * 10 : '—') : '');
                var c = groups[label] = groups[label] || {};
                Object.keys(r).forEach(function (k) { if (typeof r[k] === 'number' && k !== 'year') c[k] = (c[k] || 0) + r[k]; });
            });
            var labels = Object.keys(groups).sort();
            var coverage = table([text('scope_subset'), text('research_records'), text('research_title'),
                text('research_fulltext'), text('research_public'), text('research_selected')], labels.map(function (k) {
                var c = groups[k];
                return [k, c.records, c.title_available, c.fulltext_available + ' (' + (100 * c.fulltext_available / c.records).toFixed(1) + '%)',
                    c.public_fulltext, c.selected];
            }));
            coverage.querySelectorAll('tbody tr').forEach(function (row, i) {
                var c = groups[labels[i]];
                var meter = P.el('meter');
                meter.min = 0; meter.max = c.records; meter.value = c.fulltext_available;
                meter.setAttribute('aria-label', labels[i] + ': ' + text('research_fulltext'));
                row.children[3].appendChild(meter);
            });
            output.appendChild(coverage);
            var d = P.el('details'); d.appendChild(P.el('summary', null, text('research_sensitivity')));
            d.appendChild(P.el('p', null, text('research_sensitivity_note')));
            d.appendChild(table([text('scope_subset'), text('research_title'), text('research_fulltext'), text('research_union'),
                text('research_broad_'), text('research_legacy')], labels.map(function (k) {
                var c = groups[k]; return [k, c.title_matches, c.fulltext_matches, c.union_matches, c.broad_union_matches, c.legacy_only];
            })));
            output.appendChild(d);
        }
        draw(); return root;
    };
})();
