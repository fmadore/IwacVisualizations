/**
 * IWAC Visualizations — Entity Networks: details sidebar
 *
 * Companion panel to the graph canvas. With nothing selected it shows
 * the network's headline stats and a how-to-read note; with a node
 * selected it shows the entity (linked to its Omeka item page), its
 * counts, a toggle for the interactive neighbourhood graph, and the
 * strongest co-occurring entities — each row jumps the graph to that
 * neighbour, and pointing at a row rings its node on the map.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.entity-networks/details: panels.js must load first');
        return;
    }

    var NEIGHBOR_CAP = 15;

    function render(host, opts) {
        opts = opts || {};
        var siteBase = opts.siteBase || '';
        var onJump = opts.onJump || function () {};
        var onHover = opts.onHover || function () {};
        var onToggleEgo = opts.onToggleEgo || null;

        var root = P.el('div', 'iwac-vis-networks-details');
        host.appendChild(root);

        var overview = { stats: '', note: '' };

        function typeLabel(types, typeIndex) {
            if (!types || typeIndex == null || !types[typeIndex]) return '';
            return P.t('entity_type_' + types[typeIndex]);
        }

        function renderOverview() {
            root.innerHTML = '';
            root.appendChild(P.el('div', 'iwac-vis-aside__label iwac-vis-networks-details__label',
                P.t('About this network')));
            if (overview.stats) {
                root.appendChild(P.el('p', 'iwac-vis-networks-details__stats', overview.stats));
            }
            if (overview.note) {
                root.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-networks-details__note',
                    overview.note));
            }
            root.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-networks-details__note',
                P.t('network_select_hint')));
        }

        function renderSelection(selection, types, view) {
            view = view || {};
            onHover(null);
            root.innerHTML = '';
            var node = selection.node;

            var header = P.el('div', 'iwac-vis-networks-details__header');
            if (siteBase && node.id) {
                var link = document.createElement('a');
                link.className = 'iwac-vis-networks-details__title';
                link.href = P.itemUrl(siteBase, node.id);
                link.textContent = node.label;
                header.appendChild(link);
            } else {
                header.appendChild(P.el('strong', 'iwac-vis-networks-details__title', node.label));
            }
            var bits = [];
            var tl = typeLabel(types, node.type);
            if (tl) bits.push(tl);
            // Numbers, not formatNumber() strings: t() formats a numeric
            // count itself, and only a number selects "1 link" over "1 links".
            bits.push(P.t('items_count', { count: node.count }));
            bits.push(P.t('links_count', { count: node.degree }));
            header.appendChild(P.el('div', 'iwac-vis-networks-details__meta', bits.join(' · ')));
            root.appendChild(header);

            // The way into the close-up, beside the list it draws. Pressed
            // while the neighbourhood graph is showing, so the same button
            // is the way back.
            if (onToggleEgo && selection.neighbors.length) {
                var egoBtn = P.el('button', 'iwac-vis-btn iwac-vis-networks-details__ego',
                    view.ego ? P.t('Back to the full network') : P.t('Explore its neighbourhood'));
                egoBtn.type = 'button';
                egoBtn.setAttribute('aria-pressed', view.ego ? 'true' : 'false');
                egoBtn.addEventListener('click', function () { onToggleEgo(!view.ego); });
                root.appendChild(egoBtn);
            }

            root.appendChild(P.el('div', 'iwac-vis-aside__label iwac-vis-networks-details__label',
                P.t('Strongest co-occurrences')));

            var list = P.el('ul', 'iwac-vis-networks-details__list');
            selection.neighbors.slice(0, NEIGHBOR_CAP).forEach(function (nb) {
                var li = P.el('li');
                var btn = P.el('button', 'iwac-vis-list-item iwac-vis-networks-details__item');
                btn.type = 'button';
                btn.title = P.t('cooccurrence_title', { count: nb.weight });
                btn.appendChild(P.el('span', 'iwac-vis-list__name', nb.node.label));
                btn.appendChild(P.el('span', 'iwac-vis-list-item__count',
                    P.formatNumber(nb.weight)));
                btn.addEventListener('click', function () { onJump(nb.index); });
                btn.addEventListener('mouseenter', function () { onHover(nb.index); });
                btn.addEventListener('focus', function () { onHover(nb.index); });
                btn.addEventListener('mouseleave', function () { onHover(null); });
                btn.addEventListener('blur', function () { onHover(null); });
                li.appendChild(btn);
                list.appendChild(li);
            });
            root.appendChild(list);

            if (selection.neighbors.length > NEIGHBOR_CAP) {
                root.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-networks-details__note',
                    P.t('more_links_count', {
                        count: selection.neighbors.length - NEIGHBOR_CAP
                    })));
            }
        }

        renderOverview();

        return {
            setOverview: function (stats, note) {
                overview.stats = stats || '';
                overview.note = note || '';
                renderOverview();
            },
            showSelection: function (selection, types, view) {
                if (selection) {
                    renderSelection(selection, types, view);
                } else {
                    onHover(null);
                    renderOverview();
                }
            }
        };
    }

    ns.entityNetworks = ns.entityNetworks || {};
    ns.entityNetworks.details = { render: render };
})();
