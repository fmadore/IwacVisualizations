/**
 * IWAC Visualizations — Index Overview: Keywords filters UI
 *
 * Sidebar of filter controls for the Keyword Explorer:
 *   - Type tabs (Subjects / Spatial Coverage)
 *   - Facet selector (Global / By country / By newspaper)
 *   - Conditional country/newspaper <select>
 *   - View mode toggle (Top frequent / Compare)
 *   - Top-N picker (3 / 5 / 10)  — only in "top" view
 *   - Keyword search + multi-select checklist  — only in "compare" view
 *
 * Mutates the shared keywords-state manager; the chart and table
 * subscribe to that state separately. No URL state — filters reset on
 * reload, which is correct behavior for an embedded page block.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.index-overview/keywords-filters: panels.js must load first');
        return;
    }

    var TOP_N_OPTIONS = [3, 5, 10];

    function render(host, state, datasets) {
        host.innerHTML = '';
        var root = P.el('div', 'iwac-vis-keywords-filters');
        host.appendChild(root);

        // --- Type tabs -------------------------------------------------
        var typeTabs = P.el('div', 'iwac-vis-tabs');
        var typeButtons = {};
        [
            { key: 'subject', labelKey: 'Subjects' },
            { key: 'spatial', labelKey: 'Spatial Coverage' }
        ].forEach(function (t) {
            var btn = P.el('button', 'iwac-vis-tab', P.t(t.labelKey));
            btn.type = 'button';
            btn.dataset.type = t.key;
            btn.addEventListener('click', function () { state.set('type', t.key); });
            typeButtons[t.key] = btn;
            typeTabs.appendChild(btn);
        });
        root.appendChild(labeledGroup(P.t('Field'), typeTabs));

        // --- Facet selector --------------------------------------------
        var facetSelect = P.el('select', 'iwac-vis-keywords-filters__select');
        [
            { key: 'global',    labelKey: 'Global' },
            { key: 'country',   labelKey: 'By country' },
            { key: 'newspaper', labelKey: 'By newspaper' }
        ].forEach(function (f) {
            var opt = P.el('option', null, P.t(f.labelKey));
            opt.value = f.key;
            facetSelect.appendChild(opt);
        });
        facetSelect.addEventListener('change', function () { state.set('facet', facetSelect.value); });
        root.appendChild(labeledGroup(P.t('Facet by'), facetSelect));

        // --- Country select (conditional) ------------------------------
        var countryWrap = P.el('div');
        var countrySelect = P.el('select', 'iwac-vis-keywords-filters__select');
        var allCountriesOpt = P.el('option', null, P.t('All countries'));
        allCountriesOpt.value = '';
        countrySelect.appendChild(allCountriesOpt);
        ((datasets.metadata && datasets.metadata.countries) || []).forEach(function (c) {
            var opt = P.el('option', null, c);
            opt.value = c;
            countrySelect.appendChild(opt);
        });
        countrySelect.addEventListener('change', function () {
            state.set('country', countrySelect.value || null);
        });
        countryWrap.appendChild(labeledGroup(P.t('Country'), countrySelect));

        // --- Newspaper select (conditional) ----------------------------
        var newspaperWrap = P.el('div');
        var newspaperSelect = P.el('select', 'iwac-vis-keywords-filters__select');
        var allNewsOpt = P.el('option', null, P.t('All newspapers'));
        allNewsOpt.value = '';
        newspaperSelect.appendChild(allNewsOpt);
        ((datasets.metadata && datasets.metadata.newspapers) || []).forEach(function (n) {
            var opt = P.el('option', null, n);
            opt.value = n;
            newspaperSelect.appendChild(opt);
        });
        newspaperSelect.addEventListener('change', function () {
            state.set('newspaper', newspaperSelect.value || null);
        });
        newspaperWrap.appendChild(labeledGroup(P.t('Newspaper'), newspaperSelect));

        root.appendChild(countryWrap);
        root.appendChild(newspaperWrap);

        // --- View mode toggle ------------------------------------------
        var viewTabs = P.el('div', 'iwac-vis-tabs');
        var viewButtons = {};
        [
            { key: 'top',     labelKey: 'Top frequent' },
            { key: 'compare', labelKey: 'Compare' }
        ].forEach(function (v) {
            var btn = P.el('button', 'iwac-vis-tab', P.t(v.labelKey));
            btn.type = 'button';
            btn.dataset.view = v.key;
            btn.addEventListener('click', function () { state.set('view', v.key); });
            viewButtons[v.key] = btn;
            viewTabs.appendChild(btn);
        });
        root.appendChild(labeledGroup(P.t('View mode'), viewTabs));

        // --- Top-N picker (top mode only) ------------------------------
        var topNWrap = P.el('div');
        var topNSelect = P.el('select', 'iwac-vis-keywords-filters__select');
        TOP_N_OPTIONS.forEach(function (n) {
            var opt = P.el('option', null, P.t('top_n_keywords', { count: n }));
            opt.value = String(n);
            topNSelect.appendChild(opt);
        });
        topNSelect.addEventListener('change', function () {
            state.set('topN', parseInt(topNSelect.value, 10) || 5);
        });
        topNWrap.appendChild(labeledGroup(P.t('Number to show'), topNSelect));
        root.appendChild(topNWrap);

        // --- Compare-mode picker ---------------------------------------
        var compareWrap = P.el('div', 'iwac-vis-keywords-compare');
        var compareLabel = P.el('div', 'iwac-vis-keywords-filters__label',
            P.t('select_up_to_n', { count: state.MAX_SELECTED }));
        compareWrap.appendChild(compareLabel);

        var selectedBadges = P.el('div', 'iwac-vis-keywords-compare__badges');
        compareWrap.appendChild(selectedBadges);

        var searchInput = P.el('input', 'iwac-vis-keywords-compare__search');
        searchInput.type = 'search';
        searchInput.placeholder = P.t('Search keywords');
        searchInput.setAttribute('aria-label', P.t('Search keywords'));
        compareWrap.appendChild(searchInput);

        var checklist = P.el('div', 'iwac-vis-keywords-compare__list');
        compareWrap.appendChild(checklist);

        var clearBtn = P.el('button', 'iwac-vis-btn iwac-vis-btn--ghost', P.t('Clear selection'));
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', function () { state.clearSelection(); });
        compareWrap.appendChild(clearBtn);

        root.appendChild(compareWrap);

        function currentAllKeywords() {
            var d = state.currentData();
            return (d && d.all_keywords) || [];
        }

        function renderChecklist() {
            checklist.innerHTML = '';
            var query = (searchInput.value || '').trim().toLowerCase();
            var selected = state.get().selected;
            var pool = currentAllKeywords();
            var matches = pool.filter(function (item) {
                if (!query) return true;
                return item.keyword.toLowerCase().indexOf(query) !== -1;
            }).slice(0, 100);

            matches.forEach(function (item) {
                var row = P.el('label', 'iwac-vis-keywords-compare__item');
                var cb = P.el('input');
                cb.type = 'checkbox';
                cb.checked = selected.indexOf(item.keyword) !== -1;
                var disabled = !cb.checked && selected.length >= state.MAX_SELECTED;
                cb.disabled = disabled;
                cb.addEventListener('change', function () {
                    state.toggleKeyword(item.keyword, cb.checked);
                });
                row.appendChild(cb);
                var label = P.el('span', 'iwac-vis-keywords-compare__name', item.keyword);
                var count = P.el('span', 'iwac-vis-keywords-compare__count',
                    ' (' + P.formatNumber(item.total) + ')');
                row.appendChild(label);
                row.appendChild(count);
                checklist.appendChild(row);
            });
        }

        function renderBadges() {
            selectedBadges.innerHTML = '';
            var selected = state.get().selected;
            if (selected.length === 0) {
                selectedBadges.appendChild(P.el('em', 'iwac-vis-muted', P.t('No keywords selected')));
                return;
            }
            selected.forEach(function (kw) {
                var badge = P.el('button', 'iwac-vis-chip', kw + ' \u00d7');
                badge.type = 'button';
                badge.setAttribute('aria-label', kw);
                badge.addEventListener('click', function () { state.toggleKeyword(kw, false); });
                selectedBadges.appendChild(badge);
            });
        }

        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(renderChecklist, 120);
        });

        function applyStateToUI() {
            var snap = state.get();

            Object.keys(typeButtons).forEach(function (k) {
                typeButtons[k].classList.toggle('iwac-vis-tab--active', k === snap.type);
            });
            Object.keys(viewButtons).forEach(function (k) {
                viewButtons[k].classList.toggle('iwac-vis-tab--active', k === snap.view);
            });
            facetSelect.value = snap.facet;
            countrySelect.value = snap.country || '';
            newspaperSelect.value = snap.newspaper || '';
            topNSelect.value = String(snap.topN);

            countryWrap.style.display   = snap.facet === 'country'   ? '' : 'none';
            newspaperWrap.style.display = snap.facet === 'newspaper' ? '' : 'none';
            topNWrap.style.display      = snap.view === 'top'        ? '' : 'none';
            compareWrap.style.display   = snap.view === 'compare'    ? '' : 'none';

            renderBadges();
            renderChecklist();
        }

        state.subscribe(applyStateToUI);
        applyStateToUI();
    }

    function labeledGroup(labelText, controlEl) {
        var wrap = P.el('div', 'iwac-vis-keywords-filters__group');
        wrap.appendChild(P.el('div', 'iwac-vis-keywords-filters__label', labelText));
        wrap.appendChild(controlEl);
        return wrap;
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsFilters = { render: render };
})();
