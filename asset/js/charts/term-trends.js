/**
 * IWAC Visualizations — Term Trends page block (orchestrator)
 *
 * The "IWAC Ngram viewer" (ROADMAP 9.6): plot the per-year document
 * frequency of ANY frequent lemma in the articles subset. Distinct from
 * Keyword Explorer (item tagging) and Scary Terms (fixed vocabulary) —
 * this is full-text.
 *
 * Data: `term-trends-index.json` (search index + per-year article totals)
 * up front; per-letter shards `term-trends/{a..z,0}.json` fetched lazily
 * when a term is first selected. Both built by
 * `scripts/generate_term_trends.py`.
 *
 * UI: search box with a suggestion dropdown, removable term chips (max 8),
 * absolute-count vs share-of-articles toggle, multi-line chart.
 *
 * Load order: after shared/panels.js + shared/chart-options*.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis term-trends: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    var MAX_SELECTED = 8;
    var SUGGESTION_LIMIT = 12;
    // Default picks for the empty state — the first of these present in
    // the vocabulary are preselected so the block never opens blank.
    var DEFAULT_TERMS = ['islam', 'musulman', 'religion'];

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading term trends':   'Loading term trends',
            'ngram.title':           'Term trends',
            'ngram.description':     'How often a word appears in the digitized press over time — the share (or count) of articles each year whose text contains the term. Vocabulary: the {n} most frequent dictionary forms (lemmas), so “terroriste” and “terroristes” count as one term.',
            'ngram.search':          'Search a term…',
            'ngram.no_matches':      'No matching term',
            'ngram.selected':        'Terms (up to {max})',
            'ngram.clear':           'Clear',
            'ngram.mode_share':      'Share of articles',
            'ngram.mode_count':      'Article count',
            'ngram.axis_share':      '% of articles',
            'ngram.axis_count':      'Articles',
            'ngram.tip_share':       '{pct} % of {total} articles',
            'ngram.tip_count':       '{count} of {total} articles',
            'ngram.empty':           'Search for a term above to plot it.',
            'ngram.in_articles':     'in {count} articles'
        });
        ns.addTranslations('fr', {
            'Loading term trends':   'Chargement des tendances lexicales',
            'ngram.title':           'Tendances lexicales',
            'ngram.description':     'Fréquence d’un mot dans la presse numérisée au fil du temps — la part (ou le nombre) d’articles de chaque année dont le texte contient le terme. Vocabulaire : les {n} formes lexicales (lemmes) les plus fréquentes, donc « terroriste » et « terroristes » comptent comme un seul terme.',
            'ngram.search':          'Rechercher un terme…',
            'ngram.no_matches':      'Aucun terme correspondant',
            'ngram.selected':        'Termes (jusqu’à {max})',
            'ngram.clear':           'Effacer',
            'ngram.mode_share':      'Part des articles',
            'ngram.mode_count':      'Nombre d’articles',
            'ngram.axis_share':      '% des articles',
            'ngram.axis_count':      'Articles',
            'ngram.tip_share':       '{pct} % de {total} articles',
            'ngram.tip_count':       '{count} articles sur {total}',
            'ngram.empty':           'Recherchez un terme ci-dessus pour le tracer.',
            'ngram.in_articles':     'dans {count} articles'
        });
    }

    /** Client-side twin of generate_term_trends.py::shard_key. NFD puts
     *  the base letter first, so the accent-folded initial is simply the
     *  first char of the decomposition — no combining-mark stripping. */
    function shardKey(term) {
        if (!term) return '0';
        var c = term.charAt(0).normalize('NFD').charAt(0).toLowerCase();
        return (c >= 'a' && c <= 'z') ? c : '0';
    }

    function initBlock(container) {
        var basePath = container.dataset.basePath || '';
        var dataBase = basePath + '/files/iwac-visualizations/';

        P.fetchJSON(dataBase + 'term-trends-index.json')
            .then(function (index) { buildLayout(container, index, dataBase); })
            .catch(function (err) {
                console.error('IWACVis term-trends:', err);
                container.innerHTML = '';
                container.appendChild(P.buildFetchErrorState(err));
            });
    }

    function buildLayout(container, index, dataBase) {
        var years = index.years || [];
        var totals = index.totals || [];
        var terms = index.terms || [];   // [[term, total], ...] sorted desc
        var termTotals = {};
        terms.forEach(function (pair) { termTotals[pair[0]] = pair[1]; });

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-ngram-root');
        container.appendChild(root);

        var header = P.el('div', 'iwac-vis-ngram-header');
        header.appendChild(P.el('h3', 'iwac-vis-ngram-title', P.t('ngram.title')));
        header.appendChild(P.el('p', 'iwac-vis-ngram-desc',
            P.t('ngram.description', { n: P.formatNumber(terms.length) })));
        root.appendChild(header);

        var state = {
            selected: [],          // ordered term strings
            mode: 'share'          // 'share' | 'count'
        };
        var seriesCache = {};      // term -> counts array
        var shardPromises = {};    // shard key -> Promise<shard object>

        // --- Controls ---------------------------------------------------
        var controls = P.el('div', 'iwac-vis-ngram-controls');
        root.appendChild(controls);

        var searchWrap = P.el('div', 'iwac-vis-ngram-search');
        var searchInput = P.el('input', 'iwac-vis-ngram-search__input');
        searchInput.type = 'search';
        searchInput.placeholder = P.t('ngram.search');
        searchInput.setAttribute('aria-label', P.t('ngram.search'));
        searchWrap.appendChild(searchInput);
        var dropdown = P.el('div', 'iwac-vis-ngram-search__dropdown');
        dropdown.style.display = 'none';
        searchWrap.appendChild(dropdown);
        controls.appendChild(searchWrap);

        var modeTabs = P.el('div', 'iwac-vis-tabs iwac-vis-ngram-mode');
        var modeButtons = {};
        [
            { key: 'share', labelKey: 'ngram.mode_share' },
            { key: 'count', labelKey: 'ngram.mode_count' }
        ].forEach(function (m) {
            var btn = P.el('button', 'iwac-vis-tab', P.t(m.labelKey));
            btn.type = 'button';
            btn.addEventListener('click', function () {
                if (state.mode === m.key) return;
                state.mode = m.key;
                syncModeTabs();
                draw();
            });
            modeButtons[m.key] = btn;
            modeTabs.appendChild(btn);
        });
        controls.appendChild(modeTabs);

        var chipsRow = P.el('div', 'iwac-vis-ngram-chips');
        root.appendChild(chipsRow);

        // --- Chart panel --------------------------------------------------
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-ngram-panel');
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-ngram-chart');
        panel.appendChild(chartEl);
        root.appendChild(panel);

        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            draw();
        });

        function syncModeTabs() {
            Object.keys(modeButtons).forEach(function (k) {
                modeButtons[k].classList.toggle('iwac-vis-tab--active', k === state.mode);
            });
        }

        // --- Shard loading ------------------------------------------------
        function loadTerm(term) {
            if (seriesCache[term]) return Promise.resolve(seriesCache[term]);
            var key = shardKey(term);
            if (!shardPromises[key]) {
                shardPromises[key] = P.fetchJSON(dataBase + 'term-trends/' + key + '.json');
            }
            return shardPromises[key].then(function (shard) {
                Object.keys(shard).forEach(function (t) {
                    seriesCache[t] = shard[t];
                });
                return seriesCache[term] || null;
            });
        }

        function addTerm(term) {
            if (state.selected.indexOf(term) !== -1) return;
            if (state.selected.length >= MAX_SELECTED) return;
            state.selected.push(term);
            renderChips();
            loadTerm(term).then(function () { draw(); }).catch(function (err) {
                console.warn('IWACVis term-trends: shard load failed', err);
                removeTerm(term);
            });
        }

        function removeTerm(term) {
            var idx = state.selected.indexOf(term);
            if (idx < 0) return;
            state.selected.splice(idx, 1);
            renderChips();
            draw();
        }

        // --- Search dropdown ------------------------------------------------
        function renderDropdown() {
            var query = (searchInput.value || '').trim().toLowerCase();
            dropdown.innerHTML = '';
            if (!query) {
                dropdown.style.display = 'none';
                return;
            }
            // Prefix matches first, then substring matches; the index is
            // frequency-sorted so both groups come out most-frequent-first.
            var prefix = [];
            var infix = [];
            for (var i = 0; i < terms.length
                    && prefix.length + infix.length < SUGGESTION_LIMIT * 3; i++) {
                var t = terms[i][0];
                var pos = t.indexOf(query);
                if (pos === 0) prefix.push(terms[i]);
                else if (pos > 0) infix.push(terms[i]);
            }
            var matches = prefix.concat(infix).slice(0, SUGGESTION_LIMIT);
            if (!matches.length) {
                dropdown.appendChild(P.el('div', 'iwac-vis-ngram-search__empty',
                    P.t('ngram.no_matches')));
                dropdown.style.display = '';
                return;
            }
            matches.forEach(function (pair) {
                var item = P.el('button', 'iwac-vis-ngram-search__item');
                item.type = 'button';
                item.appendChild(P.el('span', 'iwac-vis-ngram-search__term', pair[0]));
                item.appendChild(P.el('span', 'iwac-vis-ngram-search__count',
                    P.t('ngram.in_articles', { count: P.formatNumber(pair[1]) })));
                item.addEventListener('click', function () {
                    addTerm(pair[0]);
                    searchInput.value = '';
                    dropdown.style.display = 'none';
                    searchInput.focus();
                });
                dropdown.appendChild(item);
            });
            dropdown.style.display = '';
        }

        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(renderDropdown, 120);
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var first = dropdown.querySelector('.iwac-vis-ngram-search__item');
                if (first) first.click();
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
            }
        });
        document.addEventListener('click', function (e) {
            if (!searchWrap.contains(e.target)) dropdown.style.display = 'none';
        });

        // --- Chips -----------------------------------------------------------
        function renderChips() {
            chipsRow.innerHTML = '';
            chipsRow.appendChild(P.el('span', 'iwac-vis-ngram-chips__label',
                P.t('ngram.selected', { max: MAX_SELECTED })));
            state.selected.forEach(function (term) {
                var chip = P.el('button', 'iwac-vis-chip', term + ' ×');
                chip.type = 'button';
                chip.setAttribute('aria-label', term);
                chip.addEventListener('click', function () { removeTerm(term); });
                chipsRow.appendChild(chip);
            });
            if (state.selected.length > 1) {
                var clear = P.el('button', 'iwac-vis-btn iwac-vis-btn--ghost',
                    P.t('ngram.clear'));
                clear.type = 'button';
                clear.addEventListener('click', function () {
                    state.selected = [];
                    renderChips();
                    draw();
                });
                chipsRow.appendChild(clear);
            }
        }

        // --- Chart -----------------------------------------------------------
        function draw() {
            if (!currentInstance || currentInstance.isDisposed()) return;
            var ready = state.selected.filter(function (t) { return seriesCache[t]; });
            if (!ready.length) {
                currentInstance.setOption(P.emptyChartOption('ngram.empty'),
                    { notMerge: true });
                return;
            }
            var share = state.mode === 'share';
            var series = ready.map(function (term) {
                var counts = seriesCache[term] || [];
                var data = counts.map(function (c, i) {
                    if (!share) return c;
                    var total = totals[i] || 0;
                    return total ? Math.round(10000 * c / total) / 100 : null;
                });
                return {
                    name: term,
                    type: 'line',
                    showSymbol: false,
                    symbol: 'circle',
                    symbolSize: 4,
                    lineStyle: { width: 2 },
                    emphasis: { focus: 'series' },
                    connectNulls: false,
                    data: data
                };
            });

            var dataZoom = C._dataZoom(years.length, { threshold: 30 });
            var option = {
                grid: C._grid({ left: 64, top: 56, bottom: 56 }),
                legend: { type: 'scroll', top: 4, itemWidth: 14, itemHeight: 3 },
                tooltip: {
                    trigger: 'axis',
                    confine: true,
                    formatter: C.sortedAxisTooltip({
                        row: function (p, i) {
                            var total = totals[i] || 0;
                            return p.marker + ' ' + P.escapeHtml(p.seriesName) + ': '
                                + (share
                                    ? P.t('ngram.tip_share', {
                                        pct: p.value, total: P.formatNumber(total) })
                                    : P.t('ngram.tip_count', {
                                        count: P.formatNumber(p.value),
                                        total: P.formatNumber(total) }));
                        }
                    })
                },
                xAxis: {
                    type: 'category',
                    boundaryGap: false,
                    data: years.map(String),
                    name: P.t('Year'),
                    nameLocation: 'middle',
                    nameGap: 28
                },
                yAxis: Object.assign({ type: 'value' },
                    C._valueAxisName(share ? P.t('ngram.axis_share') : P.t('ngram.axis_count')),
                    share ? { axisLabel: { formatter: function (v) { return v + ' %'; } } } : {}),
                dataZoom: dataZoom,
                series: series,
                animationDuration: 400,
                animationEasing: 'cubicOut'
            };
            var R = ns.responsive;
            if (R && R.withMedia) {
                option = R.withMedia(option,
                    R.valueChartMedia({ hasZoom: dataZoom.length > 0 }));
            }
            currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
        }

        // --- Boot ------------------------------------------------------------
        syncModeTabs();
        renderChips();
        var defaults = DEFAULT_TERMS.filter(function (t) {
            return Object.prototype.hasOwnProperty.call(termTotals, t);
        });
        if (!defaults.length) {
            defaults = terms.slice(0, 3).map(function (pair) { return pair[0]; });
        }
        defaults.forEach(addTerm);
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis term-trends: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-ngram');
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
