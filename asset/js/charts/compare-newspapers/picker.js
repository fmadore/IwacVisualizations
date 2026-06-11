/**
 * IWAC Visualizations — Compare Newspapers block: corpus picker.
 *
 * Split out of compare-newspapers.js. Builds one side's picker card —
 * the articles/publications type switch, the country/newspaper scope
 * select, and the name dropdown — and reports every state change
 * through the onChange callback. Hangs off IWACVis.compareNewspapers;
 * the orchestrator builds one picker per side (A, B).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/picker: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildPicker(side, index, defaults, onChange) {
        var state = {
            type: defaults.type,
            scope: defaults.scope,
            slug: defaults.slug
        };
        var suffix = side + '-' + CN.nextUid();

        var card = P.el('div', 'iwac-vis-compare-picker');
        card.dataset.side = side;

        var eyebrow = P.el('div', 'iwac-vis-compare-picker__eyebrow',
            P.t(side === 'A' ? 'Corpus A' : 'Corpus B'));
        card.appendChild(eyebrow);

        // --- Type switch (articles / publications) -------------------
        var typeRow = P.el('div', 'iwac-vis-compare-picker__row');
        var typeLabel = P.el('span', 'iwac-vis-compare-picker__label', P.t('Type'));
        typeLabel.id = 'iwac-cmp-type-label-' + suffix;
        typeRow.appendChild(typeLabel);
        var typeBar = P.el('div', 'iwac-vis-compare-picker__type');
        typeBar.setAttribute('role', 'radiogroup');
        typeBar.setAttribute('aria-labelledby', typeLabel.id);
        var typeButtons = {};
        ['articles', 'publications'].forEach(function (key) {
            var btn = P.el('button', null,
                P.t(key === 'articles' ? 'Newspaper articles' : 'Islamic publications'));
            btn.type = 'button';
            btn.name = 'iwac-cmp-type-' + suffix;
            btn.id = 'iwac-cmp-type-' + key + '-' + suffix;
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', 'false');
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', function () {
                if (state.type === key) return;
                state.type = key;
                var subset = index.subsets && index.subsets[state.type];
                if (subset) {
                    if (state.scope === 'country' && !(subset.countries || []).length) {
                        state.scope = 'newspaper';
                    }
                    if (state.scope === 'newspaper' && !(subset.newspapers || []).length) {
                        state.scope = 'country';
                    }
                }
                rebuildScope();
                rebuildName();
                fire();
                refreshButtons();
            });
            typeButtons[key] = btn;
            typeBar.appendChild(btn);
        });
        typeRow.appendChild(typeBar);
        card.appendChild(typeRow);

        // --- Scope switch (country / newspaper) ----------------------
        var scopeRow = P.el('div', 'iwac-vis-compare-picker__row');
        var scopeLabel = P.el('label', 'iwac-vis-compare-picker__label', P.t('Scope'));
        scopeLabel.htmlFor = 'iwac-cmp-scope-' + suffix;
        scopeRow.appendChild(scopeLabel);
        var scopeSelect = P.el('select', 'iwac-vis-compare-picker__select');
        scopeSelect.id = 'iwac-cmp-scope-' + suffix;
        scopeSelect.name = 'iwac-cmp-scope-' + suffix;
        scopeSelect.addEventListener('change', function () {
            state.scope = scopeSelect.value;
            rebuildName();
            fire();
        });
        scopeRow.appendChild(scopeSelect);
        card.appendChild(scopeRow);

        // --- Name dropdown (country / newspaper name) ----------------
        var nameRow = P.el('div', 'iwac-vis-compare-picker__row');
        var nameLabel = P.el('label', 'iwac-vis-compare-picker__label', P.t('Selection'));
        nameLabel.htmlFor = 'iwac-cmp-selection-' + suffix;
        nameRow.appendChild(nameLabel);
        var nameSelect = P.el('select', 'iwac-vis-compare-picker__select');
        nameSelect.id = 'iwac-cmp-selection-' + suffix;
        nameSelect.name = 'iwac-cmp-selection-' + suffix;
        nameSelect.addEventListener('change', function () {
            state.slug = nameSelect.value;
            fire();
        });
        nameRow.appendChild(nameSelect);
        card.appendChild(nameRow);

        function refreshButtons() {
            Object.keys(typeButtons).forEach(function (k) {
                var isActive = k === state.type;
                typeButtons[k].setAttribute('aria-pressed', isActive ? 'true' : 'false');
                typeButtons[k].setAttribute('aria-checked', isActive ? 'true' : 'false');
            });
        }

        function rebuildScope() {
            scopeSelect.innerHTML = '';
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) return;
            var available = [];
            if ((subset.countries || []).length) available.push('country');
            if ((subset.newspapers || []).length) available.push('newspaper');
            available.forEach(function (s) {
                var opt = P.el('option', null,
                    P.t(s === 'country' ? 'Whole country' : 'Single newspaper'));
                opt.value = s;
                scopeSelect.appendChild(opt);
            });
            if (available.indexOf(state.scope) === -1) {
                state.scope = available[0] || 'country';
            }
            scopeSelect.value = state.scope;
        }

        function rebuildName() {
            nameSelect.innerHTML = '';
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) return;
            var list = state.scope === 'country'
                ? (subset.countries || [])
                : (subset.newspapers || []);
            // Country dropdowns stay sorted by count (5–6 entries, intuitive).
            // Newspaper dropdowns are re-sorted alphabetically — the
            // generator emits them count-desc for threshold purposes, but
            // users scan a long list faster when it's A → Z.
            if (state.scope === 'newspaper') {
                list = list.slice().sort(function (a, b) {
                    return a.name.localeCompare(b.name, ns.locale || 'fr', { sensitivity: 'base' });
                });
            }
            list.forEach(function (entry) {
                var label = entry.name + ' (' + P.formatNumber(entry.count) + ')';
                if (entry.country && state.scope === 'newspaper') {
                    label = entry.name + ' \u2014 ' + entry.country
                        + ' (' + P.formatNumber(entry.count) + ')';
                }
                var opt = P.el('option', null, label);
                opt.value = entry.slug;
                nameSelect.appendChild(opt);
            });
            var slugs = list.map(function (e) { return e.slug; });
            if (slugs.indexOf(state.slug) === -1) {
                state.slug = slugs[0] || null;
            }
            if (state.slug) nameSelect.value = state.slug;
        }

        function fire() {
            if (typeof onChange === 'function' && state.slug) {
                onChange({ type: state.type, scope: state.scope, slug: state.slug });
            }
        }

        rebuildScope();
        rebuildName();
        refreshButtons();

        return {
            root: card,
            getState: function () { return { type: state.type, scope: state.scope, slug: state.slug }; }
        };
    }

    CN.buildPicker = buildPicker;
})();
