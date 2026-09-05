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
 * Both button rows are `P.buildSegmented` groups since v1.60.0 (the shared
 * "pick one of N" widget: aria-pressed, arrow keys), and a bar can open on a
 * given sub-facet — `activeSubKey` — so a value restored from the URL is the
 * one that shows pressed. Before that, `setActive(key, subKey)` in button
 * mode set the state but could not reach the highlighter, so the pressed
 * button and the value diverged.
 *
 * Load order: after panels-controls.js (for P.buildSegmented).
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
     * @param {string} [config.activeSubKey]  sub-facet to open on (must exist
     *   under the active facet; otherwise the first one is picked as before)
     * @param {function({facet:string,subFacet:?string})} config.onChange
     * @returns {{ root: HTMLElement, setActive: function(string, string=),
     *             getActive: function(): {facet:string, subFacet:?string} }}
     */
    P.buildFacetButtons = function (config) {
        var facets = config.facets || [];
        var activeKey = config.activeKey || (facets[0] && facets[0].key);
        var activeSubKey = null;
        var subPickerContainer = null;   // the <select>, in select mode
        var subSegmented = null;         // the P.buildSegmented group, in button mode
        var openSubKey = config.activeSubKey || null;

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
        var mainSegmented = null;
        var eyebrowEl = null;
        if (singleFacet) {
            eyebrowEl = P.el('span', 'iwac-vis-facets__label', facets[0].label);
            eyebrowEl.id = labelId;
            mainBar.appendChild(eyebrowEl);
        } else if (facets.length) {
            mainSegmented = P.buildSegmented({
                options: facets.map(function (f) { return { key: f.key, label: f.label }; }),
                active: activeKey,
                name: 'facet-' + _uid,
                classes: { root: 'iwac-vis-facets__main', btn: 'iwac-vis-facets__btn',
                           active: 'iwac-vis-facets__btn--active' },
                onChange: function (key) { setActive(key); }
            });
            // The segmented root IS the main bar: same class, same children.
            root.replaceChild(mainSegmented.root, mainBar);
            mainBar = mainSegmented.root;
            // The outer root already names the whole bar; the inner group
            // would otherwise be an unnamed group inside a named one.
            mainBar.removeAttribute('role');
            Object.keys(mainSegmented.buttons).forEach(function (key) {
                mainSegmented.buttons[key].dataset.facetKey = key;
            });
        }

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
            subSegmented = null;
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

            // Open on the requested sub-facet when it exists, else the first.
            activeSubKey = (openSubKey && subFacets[openSubKey] !== undefined)
                ? openSubKey : keys[0];
            openSubKey = null;

            if (mode === 'buttons') {
                subSegmented = P.buildSegmented({
                    options: keys.map(function (k) { return { key: k, label: subFacets[k] }; }),
                    active: activeSubKey,
                    name: 'facet-' + _uid + '-' + facet.key,
                    classes: { root: 'iwac-vis-facets__sub-group', btn: 'iwac-vis-facets__sub-btn',
                               active: 'iwac-vis-facets__sub-btn--active' },
                    onChange: function (k) {
                        activeSubKey = k;
                        fire();
                    }
                });
                if (eyebrowEl) subSegmented.root.setAttribute('aria-labelledby', labelId);
                else subSegmented.root.setAttribute('aria-label', facet.label);
                Object.keys(subSegmented.buttons).forEach(function (k) {
                    subSegmented.buttons[k].dataset.subKey = k;
                });
                subBar.appendChild(subSegmented.root);
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
            select.setAttribute('data-iwac-control', 'facet-' + _uid + '-' + facet.key);
            select.value = activeSubKey;
            subPickerContainer = select;
            subBar.appendChild(select);
        }

        function highlightMain() {
            if (mainSegmented) mainSegmented.set(activeKey);
        }

        /** Reflect the active sub-facet in whichever picker is mounted. */
        function markSub() {
            if (subSegmented) subSegmented.set(activeSubKey);
            if (subPickerContainer) subPickerContainer.value = activeSubKey;
        }

        function fire() {
            if (typeof config.onChange === 'function') {
                config.onChange({ facet: activeKey, subFacet: activeSubKey });
            }
        }

        function setActive(key, subKey) {
            var facet = findFacet(key);
            if (!facet) return;
            var sameFacet = key === activeKey;
            activeKey = key;
            highlightMain();
            if (sameFacet && subKey != null && facet.subFacets && facet.subFacets[subKey] !== undefined) {
                // Same facet, new sub-facet: keep the picker, move the mark.
                activeSubKey = subKey;
                markSub();
            } else {
                activeSubKey = null;
                openSubKey = subKey || null;
                renderSubFacets(facet);
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
            setActive: setActive,
            getActive: function () { return { facet: activeKey, subFacet: activeSubKey }; }
        };
    };
})();
