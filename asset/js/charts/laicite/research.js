/**
 * IWAC Visualizations — Laïcité block: the research evidence (issue #14).
 *
 * What the collection makes observable — the coverage table and its
 * sensitivity check — plus the inspectable numbers behind every summary:
 * the timeline's annual numerators and denominators, the seasonality
 * months, the matched-sentiment comparison, the two editorial source
 * comparisons and the model-assisted relevance screen. The tables here are
 * the evidence the charts compress, so each one is a real table: a reader
 * can check a rate against its denominator without opening the JSON.
 *
 * All of it reads `trends.research`, the per corpus × country × outlet ×
 * year cells, or the metadata bundle; nothing here fetches.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite research: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    function text(key) { return P.t('laicite.' + key); }

    /**
     * An evidence table: `P.buildTable` fed positional rows.
     *
     * The shared table brings what the hand-built one here lacked: the ARIA
     * roles, the card roles that turn it into labelled records below `sm`
     * (the old `data-label` attributes matched no rule anywhere, so on a
     * phone these scrolled sideways), and locale formatting — "12345" used
     * to print bare on the French site.
     *
     * A header is a label, or a column spec (`{label, render, card}`) handed
     * through to buildTable; a function render owns its cell. A column whose
     * values are all numbers renders as `'number'`; a number in a mixed
     * column (a count beside an em dash) is formatted here, so no cell
     * prints an unformatted figure. Years go in as strings — a locale
     * formatter writes 1995 as "1,995".
     *
     * @param {Array<string|Object>} headers
     * @param {Array<Array<*>>} rows
     * @returns {HTMLElement}  the table wrapper
     */
    L.researchTable = function (headers, rows) {
        var columns = headers.map(function (h, i) {
            var col = typeof h === 'string' ? { label: h } : Object.assign({}, h);
            col.key = 'c' + i;
            if (!col.render) {
                var numeric = rows.length > 0 && rows.every(function (r) {
                    return r[i] == null || typeof r[i] === 'number';
                });
                col.render = numeric ? 'number' : 'text';
            }
            return col;
        });
        var objects = rows.map(function (r) {
            var row = {};
            columns.forEach(function (col, i) {
                var v = r[i];
                row[col.key] = col.render === 'text' && typeof v === 'number'
                    ? P.formatNumber(v) : v;
            });
            return row;
        });
        return P.buildTable({ columns: columns, rows: objects }).root;
    };

    /** The countries the research cells are split by, sorted. */
    L.researchCountries = function (bundle) {
        return Array.from(new Set(((bundle || {}).cells || []).map(function (r) {
            return r.country;
        }).filter(Boolean))).sort();
    };

    /** The outlets one corpus's research cells name, sorted. */
    L.researchOutlets = function (bundle, subset) {
        return Array.from(new Set(((bundle || {}).cells || []).filter(function (r) {
            return r.subset === subset && r.outlet;
        }).map(function (r) { return r.outlet; }))).sort();
    };

    L.buildMatchedSentiment = function (data) {
        var root = P.el('details');
        root.appendChild(P.el('summary', null, text('research_matched')));
        root.appendChild(P.el('p', null, text('research_matched_note')));
        Object.keys(data.matched || {}).forEach(function (prop) {
            var d = data.matched[prop];
            var heading = prop === 'polarite' ? 'polarity' : prop === 'centralite' ? 'centrality' : 'subjectivity';
            root.appendChild(P.el('h5', null, text('research_' + heading)));
            root.appendChild(P.el('p', null, P.t('laicite.research_matched_n', d)));
            var share = function (n) {
                return d.matched ? L.formatPercent(L.pct(n || 0, d.matched)) : '—';
            };
            root.appendChild(L.researchTable(
                [text('research_label'), text('research_selected'), text('research_controls')],
                Array.from(new Set(Object.keys(d.dossier).concat(Object.keys(d.weighted_controls)))).sort().map(function (k) {
                    return [P.t(k), share(d.dossier[k]), share(d.weighted_controls[k])];
                })));
        });
        return root;
    };

    L.buildSourceComparisons = function (siteBase) {
        var root = P.el('section', 'iwac-vis-panel');
        root.appendChild(P.el('h4', null, text('research_cases')));
        ['76294', '11382'].forEach(function (id) {
            var link = P.el('a', null, text('research_case_' + id));
            link.href = P.itemUrl(siteBase, id);
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
        details.appendChild(L.researchTable([P.t('Year'), text('research_matches'), text('research_hits'),
            text('research_eligible'), text('research_records')], r.years.map(function (y) {
            var c = r.evidence[y] || { matches: 0, hits: 0, eligible: 0, records: 0 };
            return [String(y), c.matches, c.hits, c.eligible, c.records];
        })));
        root.appendChild(details); return root;
    };

    /**
     * The month counts behind the seasonality chart: for each calendar,
     * the dossier documents and the eligible documents per month — the
     * numerator and the denominator of every bar. Null when the bundle
     * predates the exposure arrays, which is when the chart plots raw
     * counts and there is no denominator to show.
     *
     * @param {Object} coverage  one corpus of laicite-seasonality.json
     * @returns {HTMLElement|null}
     */
    L.buildSeasonalityEvidence = function (coverage) {
        var cov = coverage || {};
        if (!cov.gregorian_exposure || !cov.hijri_exposure) return null;
        var details = P.el('details');
        details.appendChild(P.el('summary', null, text('research_inspect')));
        ['gregorian', 'hijri'].forEach(function (calendar) {
            details.appendChild(P.el('h5', null, text(calendar)));
            var names = text(calendar === 'gregorian' ? 'months' : 'hijri_months').split(',');
            details.appendChild(L.researchTable(
                [text(calendar), text('research_selected'), text('research_eligible')],
                names.map(function (name, i) {
                    return [name, (cov[calendar] || [])[i] || 0,
                        cov[calendar + '_exposure'][i] || 0];
                })));
        });
        return details;
    };

    /**
     * The model-assisted relevance screen, rendered ENTIRELY from
     * `metadata.audit_screen`. Every number on screen comes from the
     * versioned verdict ledger the generator emits, so a later audit of
     * newly ingested records updates this panel by republishing data — the
     * alternative, a paragraph of hardcoded percentages, is stale the day
     * the corpus grows and nothing in the build would say so.
     *
     * Returns null when the field is absent (older bundles) or when nothing
     * has been screened: a screen with no verdicts has nothing to report,
     * and "0 of 0 judged relevant" would read as a finding.
     *
     * @param {Object} metadata  laicite-metadata.json
     * @returns {HTMLElement|null}
     */
    L.buildAuditScreen = function (metadata) {
        var a = (metadata || {}).audit_screen;
        if (!a || !a.members_judged) return null;

        var judged = a.members_judged || 0;
        var total = a.members_total || judged;
        var relevant = a.relevant || 0;

        var root = P.el('details');
        root.appendChild(P.el('summary', null, P.t('laicite.research_screen', {
            date: a.judged_at
                ? P.formatDate(a.judged_at, { year: 'numeric', month: 'long' })
                : '—'
        })));
        root.appendChild(P.el('p', null, P.t('laicite.research_screen_note', {
            model: a.model || '—',
            judged: P.formatNumber(judged),
            total: P.formatNumber(total),
            relevant: P.formatNumber(relevant),
            percent: L.formatDecimal(L.pct(relevant, judged))
        })));
        // Coverage of the screen itself. A reader comparing the dossier
        // total with the screened total should not have to subtract.
        if (total > judged) {
            root.appendChild(P.el('p', null,
                P.t('laicite.research_screen_pending', { count: total - judged })));
        }

        /** One breakdown table from a {key: {judged, relevant}} map. */
        function breakdown(headingKey, firstColKey, map, labelFor, order) {
            var keys = order
                ? order.filter(function (k) { return map[k]; })
                : Object.keys(map || {});
            if (!keys.length) return;
            root.appendChild(P.el('h5', null, text(headingKey)));
            root.appendChild(L.researchTable(
                [text(firstColKey), text('research_screen_judged'),
                    text('research_screen_relevant'), text('research_screen_share')],
                keys.map(function (k) {
                    var cell = map[k] || {};
                    var n = cell.judged || 0;
                    return [labelFor(k) || k, n, cell.relevant || 0,
                        n ? L.formatPercent(L.pct(cell.relevant || 0, n)) : '—'];
                })));
        }

        breakdown('research_screen_routes', 'research_screen_route',
            a.by_route || {}, L.routeLabel, L.ROUTE_ORDER);
        breakdown('research_screen_subsets', 'scope_subset',
            a.by_subset || {}, L.subsetLabel, L.SUBSETS);

        // The two readings the numbers do NOT license, and the provenance
        // of the verdicts. Static text: neither depends on the counts.
        root.appendChild(P.el('p', null, text('research_screen_tag_only')));
        root.appendChild(P.el('p', null, text('research_screen_lexicon')));
        root.appendChild(P.el('p', null, P.t('laicite.research_screen_limit',
            { rule: a.rule_version || '—' })));
        return root;
    };

    /**
     * The full-text cell of the coverage table: the count and its share of
     * the records, over the same themed meter the corpus table draws. A
     * native `<meter>` here painted in the browser's own green, the one
     * unthemed colour on the page, and ignored dark mode.
     *
     * @param {string} label  the column label, repeated in the record layout
     * @param {string} key    the cell's key in the row ('c' + column index)
     */
    function fullTextCell(label, key) {
        return function (row, td) {
            var v = row[key] || {};
            td.className += ' iwac-vis-laicite-readable';
            var cardLabel = P.tableCardLabel(label);
            if (cardLabel) td.appendChild(cardLabel);
            var share = L.pct(v.available || 0, v.records);
            td.appendChild(P.el('span', 'iwac-vis-laicite-readable-n',
                P.formatNumber(v.available || 0) + ' (' + L.formatPercent(share) + ')'));
            var meter = P.el('span', 'iwac-vis-laicite-meter');
            var fill = P.el('span', 'iwac-vis-laicite-meter-fill');
            fill.style.width = share + '%';
            meter.appendChild(fill);
            td.appendChild(meter);
        };
    }

    /**
     * "What can we observe?" — coverage of the whole input collection, per
     * corpus, by country and optionally by decade, with the field-choice
     * sensitivity check and the relevance screen beneath it.
     *
     * The two pickers are block state, not local variables. The country is
     * the block's `trendsCountry` — this table and the timeline read the
     * same research cells, so they are one choice, kept in step with the
     * map, the arenas and the concordance by the reducer and addressable as
     * `laicite.country`; the grouping is `coveragePeriod`
     * (`laicite.coverage=decade`). Both used to be local variables: a
     * fifth country picker the URL and the other four never heard about.
     *
     * Built once per visit; `update(state)` swaps the two tables and
     * nothing else, so the sensitivity `<details>` and the screen keep
     * whatever the reader opened.
     *
     * @param {Object|null} bundle    `trends.research`
     * @param {Object} metadata
     * @param {Object} [store]        the block's P.createStore; without one
     *        (a standalone render) the pickers drive a private state
     * @returns {{root: HTMLElement, update: function(Object=):void}}
     */
    L.buildResearch = function (bundle, metadata, store) {
        var root = P.el('section', 'iwac-vis-panel iwac-vis-laicite-coverage');
        root.appendChild(P.el('h4', null, text('research_coverage')));
        if (!bundle) {
            root.appendChild(P.buildNoDataState());
            return { root: root, update: function () {} };
        }
        root.appendChild(P.el('p', 'iwac-vis-panel-desc', text('research_coverage_note')));

        var state = store ? store.state : { trendsCountry: null, coveragePeriod: '' };
        function set(changes) {
            if (store) { store.patch(changes); return; }
            Object.assign(state, changes);
            paint(state);
        }

        var countries = L.researchCountries(bundle);
        var controls = P.el('div', 'iwac-vis-controls-slot');
        var countrySelect = P.buildSelectControl({
            name: 'laicite-coverage-country', idPrefix: 'laicite-coverage-country',
            label: P.t('Country'),
            options: [{ value: '', label: text('scope_global') }].concat(countries.map(function (c) {
                return { value: c, label: c };
            })),
            current: '',
            onChange: function (v) { set({ trendsCountry: v || null }); }
        });
        var periodSelect = P.buildSelectControl({
            name: 'laicite-coverage-period', idPrefix: 'laicite-coverage-period',
            label: text('research_period'),
            options: [{ value: '', label: text('filter_all') },
                { value: 'decade', label: text('research_decade') }],
            current: '',
            onChange: function (v) { set({ coveragePeriod: v }); }
        });
        controls.appendChild(countrySelect);
        controls.appendChild(periodSelect);
        root.appendChild(controls);

        var coverageHost = P.el('div');
        root.appendChild(coverageHost);

        var sensitivity = P.el('details');
        sensitivity.appendChild(P.el('summary', null, text('research_sensitivity')));
        sensitivity.appendChild(P.el('p', null, text('research_sensitivity_note')));
        var sensitivityTable = null;
        root.appendChild(sensitivity);

        var screen = L.buildAuditScreen(metadata);
        if (screen) root.appendChild(screen);

        var painted = null;
        function paint(st) {
            // A country the research cells do not split by (one picked on
            // the map, say) reads as all countries here rather than as an
            // empty table under a select showing something else.
            var country = countries.indexOf(st.trendsCountry) !== -1 ? st.trendsCountry : '';
            var grouped = st.coveragePeriod === 'decade';
            countrySelect.control.value = country;
            periodSelect.control.value = grouped ? 'decade' : '';
            // update() runs on every change anywhere in the block; only
            // these two keys change what the tables say.
            var key = country + '|' + grouped;
            if (key === painted) return;
            painted = key;

            var groups = {};
            bundle.cells.filter(function (r) { return r.country === country; }).forEach(function (r) {
                var label = L.subsetLabel(r.subset)
                    + (grouped ? ' · ' + (r.year ? Math.floor(r.year / 10) * 10 : '—') : '');
                var c = groups[label] = groups[label] || {};
                Object.keys(r).forEach(function (k) {
                    if (typeof r[k] === 'number' && k !== 'year') c[k] = (c[k] || 0) + r[k];
                });
            });
            var labels = Object.keys(groups).sort();

            coverageHost.innerHTML = '';
            coverageHost.appendChild(L.researchTable([
                { label: text('scope_subset'), card: 'title' },
                text('research_records'),
                text('research_title'),
                { label: text('research_fulltext'), card: 'row', render: fullTextCell(text('research_fulltext'), 'c3') },
                text('research_public'),
                text('research_selected')
            ], labels.map(function (k) {
                var c = groups[k];
                return [k, c.records, c.title_available,
                    { available: c.fulltext_available, records: c.records },
                    c.public_fulltext, c.selected];
            })));

            var next = L.researchTable([text('scope_subset'), text('research_title'),
                text('research_fulltext'), text('research_union'),
                text('research_broad_'), text('research_legacy')], labels.map(function (k) {
                var c = groups[k];
                return [k, c.title_matches, c.fulltext_matches, c.union_matches,
                    c.broad_union_matches, c.legacy_only];
            }));
            if (sensitivityTable) sensitivity.replaceChild(next, sensitivityTable);
            else sensitivity.appendChild(next);
            sensitivityTable = next;
        }
        paint(state);

        return {
            root: root,
            update: function (st) { paint(st || state); }
        };
    };
})();
