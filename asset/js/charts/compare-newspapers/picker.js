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

        var eyebrow = P.el('div', 'iwac-vis-eyebrow iwac-vis-compare-picker__eyebrow',
            P.t(side === 'A' ? 'Corpus A' : 'Corpus B'));
        card.appendChild(eyebrow);

        // --- Type switch (articles / publications) -------------------
        var typeRow = P.el('div', 'iwac-vis-compare-picker__row');
        var typeLabel = P.el('span', 'iwac-vis-compare-picker__label', P.t('Type'));
        typeLabel.id = 'iwac-cmp-type-label-' + suffix;
        typeRow.appendChild(typeLabel);
        // One toggle group with aria-pressed — the shared vocabulary. This
        // used to be a radiogroup whose buttons carried aria-checked AND
        // aria-pressed, two answers to the same question.
        var typeBar = P.buildSegmented({
            name: 'cmp-type-' + suffix,
            labelledBy: typeLabel.id,
            options: ['articles', 'publications'].map(function (key) {
                return {
                    key: key,
                    label: P.t(key === 'articles' ? 'Newspaper articles' : 'Islamic publications')
                };
            }),
            active: state.type,
            classes: { root: 'iwac-vis-compare-picker__type', btn: null, active: null },
            onChange: function (key) {
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
            }
        });
        typeRow.appendChild(typeBar.root);
        card.appendChild(typeRow);

        // --- Scope switch (country / newspaper) ----------------------
        var rowClasses = {
            groupClass: 'iwac-vis-compare-picker__row',
            labelClass: 'iwac-vis-compare-picker__label',
            selectClass: 'iwac-vis-compare-picker__select'
        };
        var scopeRow = CN.buildSelect(Object.assign({
            label: P.t('Scope'),
            name: 'cmp-scope-' + side,
            idPrefix: 'iwac-cmp-scope-' + side + '-',
            options: [],
            onChange: function (value) {
                state.scope = value;
                rebuildName();
                fire();
            }
        }, rowClasses));
        card.appendChild(scopeRow);

        // --- Name dropdown (country / newspaper name) ----------------
        var nameRow = CN.buildSelect(Object.assign({
            label: P.t('Selection'),
            name: 'cmp-selection-' + side,
            idPrefix: 'iwac-cmp-selection-' + side + '-',
            options: [],
            onChange: function (value) {
                state.slug = value;
                fire();
            }
        }, rowClasses));
        card.appendChild(nameRow);

        function rebuildScope() {
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) { scopeRow.setOptions([]); return; }
            var available = [];
            if ((subset.countries || []).length) available.push('country');
            if ((subset.newspapers || []).length) available.push('newspaper');
            var picked = scopeRow.setOptions(available.map(function (s) {
                return { value: s, label: P.t(s === 'country' ? 'Whole country' : 'Single newspaper') };
            }), state.scope);
            state.scope = picked || 'country';
        }

        function rebuildName() {
            var subset = index.subsets && index.subsets[state.type];
            if (!subset) { nameRow.setOptions([]); return; }
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
            var picked = nameRow.setOptions(list.map(function (entry) {
                var label = entry.name + ' (' + P.formatNumber(entry.count) + ')';
                if (entry.country && state.scope === 'newspaper') {
                    label = entry.name + ' \u2014 ' + entry.country
                        + ' (' + P.formatNumber(entry.count) + ')';
                }
                return { value: entry.slug, label: label };
            }), state.slug || '');
            state.slug = picked || null;
        }

        function fire() {
            if (typeof onChange === 'function' && state.slug) {
                onChange({ type: state.type, scope: state.scope, slug: state.slug });
            }
        }

        rebuildScope();
        rebuildName();

        /**
         * Reflect a state set elsewhere (the URL, Back); no onChange. A
         * no-op when nothing differs — which is every echo of the picker's
         * own change, so the select the reader is stepping through with the
         * arrow keys is never rebuilt under them.
         */
        function set(next) {
            if (!next) return;
            if (next.type === state.type && next.scope === state.scope
                    && next.slug === state.slug) return;
            state.type = next.type || state.type;
            state.scope = next.scope || state.scope;
            state.slug = next.slug || state.slug;
            typeBar.set(state.type);
            rebuildScope();
            rebuildName();
        }

        return {
            root: card,
            set: set,
            getState: function () { return { type: state.type, scope: state.scope, slug: state.slug }; }
        };
    }

    CN.buildPicker = buildPicker;
})();
