/**
 * IWAC Visualizations — Entity Networks: details sidebar
 *
 * Companion panel to the graph canvas. With nothing selected it shows
 * the network's headline stats and a how-to-read note; with a node
 * selected it shows the entity (linked to its Omeka item page), its
 * counts, and the strongest co-occurring entities — each row jumps the
 * graph to that neighbor.
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

        var root = P.el('div', 'iwac-vis-networks-details');
        host.appendChild(root);

        var overview = { stats: '', note: '' };

        function typeLabel(types, typeIndex) {
            if (!types || typeIndex == null || !types[typeIndex]) return '';
            return P.t('entity_type_' + types[typeIndex]);
        }

        function renderOverview() {
            root.innerHTML = '';
            root.appendChild(P.el('div', 'iwac-vis-networks-details__label',
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

        function renderSelection(selection, types) {
            root.innerHTML = '';
            var node = selection.node;

            var header = P.el('div', 'iwac-vis-networks-details__header');
            if (siteBase && node.id) {
                var link = document.createElement('a');
                link.className = 'iwac-vis-networks-details__title';
                link.href = siteBase + '/item/' + node.id;
                link.textContent = node.label;
                header.appendChild(link);
            } else {
                header.appendChild(P.el('strong', 'iwac-vis-networks-details__title', node.label));
            }
            var bits = [];
            var tl = typeLabel(types, node.type);
            if (tl) bits.push(tl);
            bits.push(P.t('items_count', { count: P.formatNumber(node.count) }));
            bits.push(P.t('links_count', { count: P.formatNumber(node.degree) }));
            header.appendChild(P.el('div', 'iwac-vis-networks-details__meta', bits.join(' · ')));
            root.appendChild(header);

            root.appendChild(P.el('div', 'iwac-vis-networks-details__label',
                P.t('Strongest co-occurrences')));

            var list = P.el('ul', 'iwac-vis-networks-details__list');
            selection.neighbors.slice(0, NEIGHBOR_CAP).forEach(function (nb) {
                var li = P.el('li');
                var btn = P.el('button', 'iwac-vis-networks-details__item');
                btn.type = 'button';
                btn.title = P.t('cooccurrence_title', {
                    count: P.formatNumber(nb.weight)
                });
                btn.appendChild(P.el('span', 'iwac-vis-networks-details__item-name', nb.node.label));
                btn.appendChild(P.el('span', 'iwac-vis-networks-details__item-count',
                    P.formatNumber(nb.weight)));
                btn.addEventListener('click', function () { onJump(nb.index); });
                li.appendChild(btn);
                list.appendChild(li);
            });
            root.appendChild(list);

            if (selection.neighbors.length > NEIGHBOR_CAP) {
                root.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-networks-details__note',
                    P.t('more_links_count', {
                        count: P.formatNumber(selection.neighbors.length - NEIGHBOR_CAP)
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
            showSelection: function (selection, types) {
                if (selection) {
                    renderSelection(selection, types);
                } else {
                    renderOverview();
                }
            }
        };
    }

    ns.entityNetworks = ns.entityNetworks || {};
    ns.entityNetworks.details = { render: render };
})();
