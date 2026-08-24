/**
 * IWAC Visualizations — Shared facet button group
 *
 * Generic facet switcher with optional sub-facets (second dimension).
 * Sub-facets render as buttons (<= 5 keys) or <select> (> 5) by
 * default, overridable per-facet via `renderAs`.
 *
 * Exposed as `P.buildFacetButtons(config)`.
 *
 * Selected state is REAL state, not just a class. Until v1.52.0 the active
 * facet was expressed only as `--active` in the class list, which paints a
 * tint and announces nothing: thirteen controls on the collection overview
 * told a screen-reader user nothing about which one was in force. Each button
 * now carries `aria-pressed`, and each `<select>` an accessible name — the
 * eyebrow label beside it is a `<span>`, so without an explicit association
 * both country pickers on that page were simply unnamed.
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

    // Ids for the label ↔ select association. A page carries several facet
    // bars, so the counter is module-level rather than per-bar.
    var _uid = 0;

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
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', P.t('Filters'));

        var mainBar = P.el('div', 'iwac-vis-facets__main');
        root.appendChild(mainBar);

        var subBar = P.el('div', 'iwac-vis-facets__sub');
        subBar.style.display = 'none';
        root.appendChild(subBar);

        // Set once per bar; reused as the <select>'s accessible name and, in
        // the single-facet case, as the `for` target of the visible eyebrow.
        var labelId = 'iwac-vis-facet-label-' + (++_uid);

        // A bar with a single facet has nothing to toggle — its lone "main
        // button" was rendering as a permanently-active, primary-tinted chip
        // that looked selected but did nothing (the salmon "Country" / "Type"
        // pseudo-buttons the user flagged as ugly). Render it as a plain
        // eyebrow label instead and let the sub-control (select / sub-buttons)
        // carry all the interaction.
        var singleFacet = facets.length === 1;
        var mainButtons = {};
        var eyebrowEl = null;
        facets.forEach(function (f) {
            if (singleFacet) {
                eyebrowEl = P.el('span', 'iwac-vis-facets__label', f.label);
                eyebrowEl.id = labelId;
                mainBar.appendChild(eyebrowEl);
                return;
            }
            var btn = P.el('button', 'iwac-vis-facets__btn', f.label);
            btn.type = 'button';
            btn.dataset.facetKey = f.key;
            btn.setAttribute('aria-pressed', 'false');
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
                var markSub = function (active) {
                    Object.keys(subButtons).forEach(function (sk) {
                        var on = sk === active;
                        subButtons[sk].classList.toggle('iwac-vis-facets__sub-btn--active', on);
                        subButtons[sk].setAttribute('aria-pressed', on ? 'true' : 'false');
                    });
                };
                keys.forEach(function (k) {
                    var btn = P.el('button', 'iwac-vis-facets__sub-btn', subFacets[k]);
                    btn.type = 'button';
                    btn.dataset.subKey = k;
                    btn.setAttribute('aria-pressed', 'false');
                    btn.addEventListener('click', function () {
                        activeSubKey = k;
                        markSub(k);
                        fire();
                    });
                    subButtons[k] = btn;
                    subBar.appendChild(btn);
                });
                // auto-pick first
                activeSubKey = keys[0];
                markSub(activeSubKey);
                return;
            }

            // mode === 'select'
            var select = P.el('select', 'iwac-vis-control iwac-vis-facets__select');
            // Name it. On a single-facet bar the visible eyebrow ("Country")
            // IS the label, so point at it — an AT then reads the same word a
            // sighted reader sees. With several facets there is no single
            // visible label, so fall back to the facet's own name.
            if (eyebrowEl) {
                select.setAttribute('aria-labelledby', labelId);
            } else {
                select.setAttribute('aria-label', facet.label);
            }
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
                var on = k === activeKey;
                mainButtons[k].classList.toggle('iwac-vis-facets__btn--active', on);
                mainButtons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
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
