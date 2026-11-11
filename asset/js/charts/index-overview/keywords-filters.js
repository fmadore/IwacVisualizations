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

    // One counter per page load: the sidebar renders several labelled groups
    // and every one of them needs an id its control can point at.
    var _uid = 0;

    function render(host, state, datasets) {
        host.innerHTML = '';
        var root = P.el('div', 'iwac-vis-keywords-filters');
        host.appendChild(root);

        // --- Type tabs -------------------------------------------------
        var typeTabs = segmentedGroup(root, P.t('Field'), 'kw-type', [
            { key: 'subject', label: P.t('Subjects') },
            { key: 'spatial', label: P.t('index.place_tags') }
        ], function (key) { state.set('type', key); });

        // --- Facet selector --------------------------------------------
        var facetSelect = selectGroup(root, P.t('Facet by'), 'kw-facet', [
            { value: 'global',    label: P.t('Global') },
            { value: 'country',   label: P.t('By country') },
            { value: 'newspaper', label: P.t('By newspaper') }
        ], function (value) { state.set('facet', value); });

        // --- Country select (conditional) ------------------------------
        var countryWrap = P.el('div');
        var countrySelect = selectGroup(countryWrap, P.t('Country'), 'kw-country',
            [{ value: '', label: P.t('All countries') }].concat(
                ((datasets.metadata && datasets.metadata.countries) || []).map(function (c) {
                    return { value: c, label: c };
                })),
            function (value) { state.set('country', value || null); });

        // --- Newspaper select (conditional) ----------------------------
        var newspaperWrap = P.el('div');
        var newspaperSelect = selectGroup(newspaperWrap, P.t('Newspaper'), 'kw-newspaper',
            [{ value: '', label: P.t('All newspapers') }].concat(
                ((datasets.metadata && datasets.metadata.newspapers) || []).map(function (n) {
                    return { value: n, label: n };
                })),
            function (value) { state.set('newspaper', value || null); });

        root.appendChild(countryWrap);
        root.appendChild(newspaperWrap);

        // --- View mode toggle ------------------------------------------
        var viewTabs = segmentedGroup(root, P.t('View mode'), 'kw-view', [
            { key: 'top',     label: P.t('Top frequent') },
            { key: 'compare', label: P.t('Compare') }
        ], function (key) { state.set('view', key); });

        // --- Top-N picker (top mode only) ------------------------------
        var topNWrap = P.el('div');
        var topNSelect = selectGroup(topNWrap, P.t('Number to show'), 'kw-topn',
            TOP_N_OPTIONS.map(function (n) {
                return { value: String(n), label: P.t('top_n_keywords', { count: n }) };
            }),
            function (value) { state.set('topN', parseInt(value, 10) || 5); });
        root.appendChild(topNWrap);

        // --- Compare-mode picker ---------------------------------------
        var compareWrap = P.el('div', 'iwac-vis-keywords-compare');
        var compareLabel = P.el('div', 'iwac-vis-aside__label iwac-vis-keywords-filters__label',
            P.t('select_up_to_n', { count: state.MAX_SELECTED }));
        compareWrap.appendChild(compareLabel);

        var selectedBadges = P.el('div', 'iwac-vis-keywords-compare__badges');
        compareWrap.appendChild(selectedBadges);

        var searchInput = P.el('input', 'iwac-vis-control iwac-vis-keywords-compare__search');
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
            var query = P.foldAccents((searchInput.value || '').trim());
            var selected = state.get().selected;
            var pool = currentAllKeywords();
            var matches = pool.filter(function (item) {
                if (!query) return true;
                return P.foldAccents(item.keyword).indexOf(query) !== -1;
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
                var label = P.el('span', 'iwac-vis-list__name iwac-vis-keywords-compare__name', item.keyword);
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

        searchInput.addEventListener('input', P.debounce(renderChecklist, 120));

        function applyStateToUI() {
            var snap = state.get();

            typeTabs.set(snap.type);
            viewTabs.set(snap.view);
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

    /**
     * A control under its eyebrow label — and NAMED by it.
     *
     * Before v1.53.0 the eyebrow was a bare `<div>` and nothing connected it
     * to its control: all four `<select>`s in this sidebar were reported as
     * unnamed, and the two tab groups were unlabelled runs of buttons. Both
     * kinds are now the shared controls (P.buildSegmented / P.buildSelectControl),
     * which carry the `data-iwac-control` handle, the shared control skin and
     * the segmented group's arrow keys; the eyebrow stays this sidebar's own.
     */
    function eyebrow(labelText) {
        var label = P.el('div', 'iwac-vis-aside__label iwac-vis-keywords-filters__label', labelText);
        label.id = 'iwac-vis-kwf-label-' + (++_uid);
        return label;
    }

    function segmentedGroup(parent, labelText, name, options, onChange) {
        var wrap = P.el('div', 'iwac-vis-keywords-filters__group');
        var label = eyebrow(labelText);
        wrap.appendChild(label);
        var seg = P.buildSegmented({
            options: options,
            labelledBy: label.id,
            name: name,
            onChange: onChange
        });
        wrap.appendChild(seg.root);
        parent.appendChild(wrap);
        return seg;
    }

    function selectGroup(parent, labelText, name, options, onChange) {
        var group = P.buildSelectControl({
            label: labelText,
            options: options,
            name: name,
            idPrefix: 'iwac-vis-kwf-',
            onChange: onChange,
            groupClass: 'iwac-vis-keywords-filters__group',
            labelClass: 'iwac-vis-aside__label iwac-vis-keywords-filters__label',
            selectClass: 'iwac-vis-keywords-filters__select',
            // An eyebrow reads as a heading, not a "Label:" run-in, as the
            // segmented groups above render theirs.
            colon: false
        });
        parent.appendChild(group);
        return group.control;
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsFilters = { render: render };
})();
