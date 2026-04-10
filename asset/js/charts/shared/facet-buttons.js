/**
 * IWAC Visualizations — Shared facet button group
 *
 * Generic facet switcher with optional sub-facets (second dimension).
 * Sub-facets render as buttons (<= 5 keys) or <select> (> 5) by
 * default, overridable per-facet via `renderAs`.
 *
 * Exposed as `P.buildFacetButtons(config)`.
 *
 * Load order: after panels.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.facet-buttons: panels.js must load first');
        return;
    }

    /**
     * @param {Object} config
     * @param {Array<Object>} config.facets
     *   Each: { key, label, subFacets?, renderAs? }
     *   - subFacets is an object { subKey: subLabel }
     *   - renderAs is 'buttons' | 'select'; default auto by count
     * @param {string} config.activeKey
     * @param {function({facet:string,subFacet:?string})} config.onChange
     * @returns {{ root: HTMLElement, setActive: function(string, string=) }}
     */
    P.buildFacetButtons = function (config) {
        var facets = config.facets || [];
        var activeKey = config.activeKey || (facets[0] && facets[0].key);
        var activeSubKey = null;
        var subPickerContainer = null;

        var root = P.el('div', 'iwac-vis-facets');

        var mainBar = P.el('div', 'iwac-vis-facets__main');
        root.appendChild(mainBar);

        var subBar = P.el('div', 'iwac-vis-facets__sub');
        subBar.style.display = 'none';
        root.appendChild(subBar);

        var mainButtons = {};
        facets.forEach(function (f) {
            var btn = P.el('button', 'iwac-vis-facets__btn', f.label);
            btn.type = 'button';
            btn.dataset.facetKey = f.key;
            btn.addEventListener('click', function () {
                setActive(f.key);
            });
            mainButtons[f.key] = btn;
            mainBar.appendChild(btn);
        });

        function findFacet(key) {
            for (var i = 0; i < facets.length; i++) {
                if (facets[i].key === key) return facets[i];
            }
            return null;
        }

        function clearSubBar() {
            subBar.innerHTML = '';
            subBar.style.display = 'none';
            subPickerContainer = null;
        }

        function renderSubFacets(facet) {
            clearSubBar();
            var subFacets = facet.subFacets;
            if (!subFacets) return;
            var keys = Object.keys(subFacets);
            if (keys.length === 0) return;

            var mode = facet.renderAs;
            if (!mode) {
                mode = keys.length <= 5 ? 'buttons' : 'select';
            }

            subBar.style.display = '';

            if (mode === 'buttons') {
                var subButtons = {};
                keys.forEach(function (k) {
                    var btn = P.el('button', 'iwac-vis-facets__sub-btn', subFacets[k]);
                    btn.type = 'button';
                    btn.dataset.subKey = k;
                    btn.addEventListener('click', function () {
                        activeSubKey = k;
                        Object.keys(subButtons).forEach(function (sk) {
                            subButtons[sk].classList.toggle(
                                'iwac-vis-facets__sub-btn--active', sk === k);
                        });
                        fire();
                    });
                    subButtons[k] = btn;
                    subBar.appendChild(btn);
                });
                // auto-pick first
                activeSubKey = keys[0];
                subButtons[activeSubKey].classList.add('iwac-vis-facets__sub-btn--active');
                return;
            }

            // mode === 'select'
            var select = P.el('select', 'iwac-vis-facets__select');
            keys.forEach(function (k) {
                var opt = P.el('option', null, subFacets[k]);
                opt.value = k;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                activeSubKey = select.value;
                fire();
            });
            activeSubKey = keys[0];
            select.value = activeSubKey;
            subPickerContainer = select;
            subBar.appendChild(select);
        }

        function highlightMain() {
            Object.keys(mainButtons).forEach(function (k) {
                mainButtons[k].classList.toggle(
                    'iwac-vis-facets__btn--active', k === activeKey);
            });
        }

        function fire() {
            if (typeof config.onChange === 'function') {
                config.onChange({ facet: activeKey, subFacet: activeSubKey });
            }
        }

        function setActive(key, subKey) {
            var facet = findFacet(key);
            if (!facet) return;
            activeKey = key;
            activeSubKey = null;
            highlightMain();
            renderSubFacets(facet);
            if (subKey && facet.subFacets && facet.subFacets[subKey]) {
                activeSubKey = subKey;
                if (subPickerContainer) subPickerContainer.value = subKey;
            }
            fire();
        }

        // Initial render — but DO NOT fire onChange yet to avoid double-render
        // on the caller's first setOption call.
        (function initial() {
            var facet = findFacet(activeKey);
            if (!facet) return;
            highlightMain();
            if (facet.subFacets) {
                renderSubFacets(facet);
            }
        })();

        return {
            root: root,
            setActive: setActive
        };
    };
})();
