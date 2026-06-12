/**
 * IWAC Visualizations — Spatial Exploration: entity picker sidebar
 *
 * Type tabs (Persons / Organizations / Events / Subjects / Places) +
 * search box + result list driven by the precomputed picker indexes in
 * spatial-exploration.json. Selecting an entity asks the shared state
 * to hydrate it from its dashboard fan-out; the current selection is
 * shown as a dismissible chip with a mini summary and a link to the
 * Omeka item. Below, a "Top places" list mirrors whatever the map is
 * currently showing (whole collection or the selected entity) and
 * flies the map to a place on click.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.spatial-exploration/picker: panels.js must load first');
        return;
    }

    var LIST_CAP = 60;
    var TOP_PLACES = 10;

    /** Accent-insensitive, case-insensitive search folding. */
    function fold(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            // Strip combining diacritical marks (U+0300–U+036F)
            .replace(/[\u0300-\u036f]/g, '');
    }

    function render(host, state) {
        var root = P.el('div', 'iwac-vis-spatial-picker');
        host.appendChild(root);

        // --- Entity type tabs ------------------------------------------
        var tabs = P.el('div', 'iwac-vis-tabs');
        var tabButtons = {};
        (state.data.types || []).forEach(function (type) {
            var btn = P.el('button', 'iwac-vis-tab', P.t('entity_type_' + type));
            btn.type = 'button';
            btn.addEventListener('click', function () { state.setType(type); });
            tabButtons[type] = btn;
            tabs.appendChild(btn);
        });
        root.appendChild(group(P.t('Entity type'), tabs));

        // --- Search + result list --------------------------------------
        var search = P.el('input', 'iwac-vis-spatial-picker__search');
        search.type = 'search';
        search.placeholder = P.t('Search entities');
        search.setAttribute('aria-label', P.t('Search entities'));

        var list = P.el('div', 'iwac-vis-spatial-picker__list');
        list.setAttribute('role', 'listbox');

        var searchGroup = group(P.t('Pick an entity'), search);
        searchGroup.appendChild(list);
        root.appendChild(searchGroup);

        // --- Current selection chip + summary ---------------------------
        var selectionBox = P.el('div', 'iwac-vis-spatial-picker__selection');
        root.appendChild(selectionBox);

        // --- Top places (collection or entity) --------------------------
        var placesBox = P.el('div', 'iwac-vis-spatial-picker__places');
        var placesTitle = P.el('div', 'iwac-vis-spatial-picker__label', P.t('Top places'));
        var placesList = P.el('ul', 'iwac-vis-spatial-picker__places-list');
        placesBox.appendChild(placesTitle);
        placesBox.appendChild(placesList);
        root.appendChild(placesBox);

        function group(labelText, controlEl) {
            var wrap = P.el('div', 'iwac-vis-spatial-picker__group');
            wrap.appendChild(P.el('div', 'iwac-vis-spatial-picker__label', labelText));
            wrap.appendChild(controlEl);
            return wrap;
        }

        function renderList() {
            list.innerHTML = '';
            var entries = (state.data.pickers || {})[state.entityType] || [];
            var query = fold(search.value.trim());
            var shown = 0;
            for (var i = 0; i < entries.length && shown < LIST_CAP; i++) {
                var row = entries[i];
                if (query && fold(row[1]).indexOf(query) === -1) continue;
                shown++;
                list.appendChild(buildRow(row));
            }
            if (shown === 0) {
                list.appendChild(P.el('div', 'iwac-vis-muted', P.t('No matches')));
            }
        }

        function buildRow(row) {
            var id = row[0], label = row[1], count = row[2];
            var btn = P.el('button', 'iwac-vis-spatial-picker__item');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            var selected = state.selection && state.selection.id === id;
            if (selected) btn.classList.add('iwac-vis-spatial-picker__item--active');
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
            btn.appendChild(P.el('span', 'iwac-vis-spatial-picker__item-name', label));
            btn.appendChild(P.el('span', 'iwac-vis-spatial-picker__item-count', P.formatNumber(count)));
            btn.addEventListener('click', function () {
                if (state.selection && state.selection.id === id) {
                    state.clearEntity();
                } else {
                    state.selectEntity(id, label, state.entityType);
                }
            });
            return btn;
        }

        function renderSelection() {
            selectionBox.innerHTML = '';
            var sel = state.selection;
            if (!sel) {
                selectionBox.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-spatial-picker__hint',
                    P.t('spatial_pick_hint')));
                return;
            }

            var chipRow = P.el('div', 'iwac-vis-spatial-picker__chip-row');
            var chip = P.el('button', 'iwac-vis-chip', sel.label + ' ×');
            chip.type = 'button';
            chip.setAttribute('aria-label', P.t('Clear selection') + ': ' + sel.label);
            chip.addEventListener('click', function () { state.clearEntity(); });
            chipRow.appendChild(chip);
            selectionBox.appendChild(chipRow);

            if (sel.status === 'loading') {
                selectionBox.appendChild(P.buildLoadingState());
                return;
            }
            if (sel.status === 'error') {
                selectionBox.appendChild(P.buildErrorState());
                return;
            }

            var s = sel.summary || {};
            var bits = [];
            if (s.total_mentions != null) {
                bits.push(P.t('mentions_count', { count: P.formatNumber(s.total_mentions) }));
            }
            if (s.year_min && s.year_max) {
                bits.push(s.year_min === s.year_max
                    ? String(s.year_min)
                    : s.year_min + '–' + s.year_max);
            }
            bits.push(P.t('places_count', { count: P.formatNumber(sel.locations.length) }));
            selectionBox.appendChild(
                P.el('p', 'iwac-vis-spatial-picker__summary', bits.join(' · ')));

            if (state.ctx.siteBase) {
                var link = document.createElement('a');
                link.className = 'iwac-vis-spatial-picker__item-link';
                link.href = state.ctx.siteBase + '/item/' + sel.id;
                link.textContent = P.t('View item page');
                selectionBox.appendChild(link);
            }
        }

        function currentPlaces() {
            var sel = state.selection;
            if (sel && sel.status === 'ready') {
                return sel.locations.map(function (l) {
                    return { id: l.o_id, name: l.name, lat: l.lat, lng: l.lng, count: l.count };
                });
            }
            if (sel) return []; // loading / error — wait for resolution
            return (state.data.locations || []).map(function (row) {
                return { id: row[0], name: row[1], lat: row[2], lng: row[3], count: row[4] };
            });
        }

        function renderPlaces() {
            placesList.innerHTML = '';
            var focus = state.focusCountry;
            var places = currentPlaces().filter(function (p) {
                return !focus || state.locationCountry(p.id) === focus;
            });
            places.slice(0, TOP_PLACES).forEach(function (p) {
                var li = P.el('li');
                var btn = P.el('button', 'iwac-vis-spatial-picker__item');
                btn.type = 'button';
                btn.appendChild(P.el('span', 'iwac-vis-spatial-picker__item-name', p.name));
                btn.appendChild(P.el('span', 'iwac-vis-spatial-picker__item-count', P.formatNumber(p.count)));
                btn.addEventListener('click', function () { state.requestFlyTo(p); });
                li.appendChild(btn);
                placesList.appendChild(li);
            });
            placesBox.style.display = places.length ? '' : 'none';
        }

        function highlightTab() {
            Object.keys(tabButtons).forEach(function (type) {
                tabButtons[type].classList.toggle(
                    'iwac-vis-tab--active', type === state.entityType);
            });
        }

        var searchTimer = null;
        search.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(renderList, 120);
        });

        state.subscribe(function (key) {
            if (key === 'type') {
                search.value = '';
                highlightTab();
                renderList();
            } else if (key === 'selection') {
                renderList();
                renderSelection();
                renderPlaces();
            } else if (key === 'focus') {
                renderPlaces();
            }
        });

        highlightTab();
        renderList();
        renderSelection();
        renderPlaces();
    }

    ns.spatialExploration = ns.spatialExploration || {};
    ns.spatialExploration.picker = { render: render };
})();
