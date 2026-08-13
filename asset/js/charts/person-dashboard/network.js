/**
 * IWAC Visualizations — Person + Entity Dashboards: Associated entities
 *
 * One analysis, two reading modes:
 *
 *   - Network: the existing live canvas force graph for finding clusters.
 *   - Relational list: an exact TF-IDF ranking whose left-hand arcs retain
 *     the neighbour↔neighbour co-occurrence structure.
 *
 * A shared single-choice entity-type filter and per-view top-N control drive
 * both. Since payload version 3 each type is ranked from the full scored pool
 * under `by_type`; older bundles still work by filtering their mixed
 * root top 50 client-side (necessarily a weaker answer, but never a crash).
 *
 * Depends on: panels.js, shared/entity-graph.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.mountEntityGraph) {
        console.warn('IWACVis.person-dashboard/network: missing deps (need shared/entity-graph.js)');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Organisations', 'Lieux', 'Sujets', 'Événements'];
    var LIMITS = [10, 20, 30, 50];
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var controlId = 0;

    function graphKey(role, type, limit) {
        return role + '\u001f' + type + '\u001f' + limit;
    }

    function centreOf(graph) {
        var nodes = (graph && graph.nodes) || [];
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] && nodes[i].type === 'center') return nodes[i];
        }
        return nodes.length ? nodes[0] : null;
    }

    function neighboursOf(graph) {
        var centre = centreOf(graph);
        return ((graph && graph.nodes) || []).filter(function (node) {
            return node && (!centre || String(node.o_id) !== String(centre.o_id));
        });
    }

    /**
     * Return one entity-type graph. New payloads provide a correctly ranked
     * variant; old payloads fall back to filtering the legacy mixed top 50.
     */
    function graphForType(roleGraph, type) {
        if (!roleGraph) return { nodes: [], edges: [] };
        if (type === 'all') {
            return { nodes: roleGraph.nodes || [], edges: roleGraph.edges || [] };
        }
        if (roleGraph.by_type && roleGraph.by_type[type]) {
            return roleGraph.by_type[type];
        }

        var centre = centreOf(roleGraph);
        var nodes = (centre ? [centre] : []).concat(
            neighboursOf(roleGraph).filter(function (node) { return node.type === type; })
        );
        var kept = {};
        nodes.forEach(function (node) { kept[String(node.o_id)] = true; });
        return {
            nodes: nodes,
            edges: (roleGraph.edges || []).filter(function (edge) {
                return kept[String(edge.source)] && kept[String(edge.target)];
            })
        };
    }

    /** Restrict a ranked graph without changing its order or edge semantics. */
    function limitGraph(graph, limit) {
        var centre = centreOf(graph);
        var nodes = (centre ? [centre] : []).concat(neighboursOf(graph).slice(0, limit));
        var kept = {};
        nodes.forEach(function (node) { kept[String(node.o_id)] = true; });
        return {
            nodes: nodes,
            edges: ((graph && graph.edges) || []).filter(function (edge) {
                return kept[String(edge.source)] && kept[String(edge.target)];
            })
        };
    }

    function buildVariants(byRole) {
        var variants = {};
        Object.keys(byRole).forEach(function (role) {
            ['all'].concat(TYPE_ORDER).forEach(function (type) {
                var graph = graphForType(byRole[role], type);
                LIMITS.forEach(function (limit) {
                    variants[graphKey(role, type, limit)] = limitGraph(graph, limit);
                });
            });
        });
        return variants;
    }

    function colorForType(type) {
        var semantics = ns.entityGraph;
        if (semantics && typeof semantics.colorForType === 'function') {
            return semantics.colorForType(type);
        }
        var palette = (ns.getPalette && ns.getPalette()) || ['#ce4115'];
        var slot = TYPE_ORDER.indexOf(type) + 1;
        return palette[Math.max(0, slot) % palette.length];
    }

    function choiceGroup(label, className) {
        var root = P.el('div', 'iwac-vis-associated__control ' + className);
        var labelEl = P.el('span', 'iwac-vis-associated__control-label', label);
        var id = 'iwac-vis-associated-control-' + (++controlId);
        labelEl.id = id;
        var choices = P.el('div', 'iwac-vis-associated__choices');
        choices.setAttribute('role', 'group');
        choices.setAttribute('aria-labelledby', id);
        root.appendChild(labelEl);
        root.appendChild(choices);
        return { root: root, choices: choices };
    }

    function choiceButton(label, onClick) {
        var button = P.el('button', 'iwac-vis-associated__choice', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', onClick);
        return button;
    }

    function svgEl(name, className) {
        var el = document.createElementNS(SVG_NS, name);
        if (className) el.setAttribute('class', className);
        return el;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};
        var roles = Object.keys(byRole);
        var hasAny = roles.some(function (role) {
            return neighboursOf(byRole[role]).length > 0;
        });
        if (!hasAny) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var variants = buildVariants(byRole);
        var activeView = 'network';
        var activeType = 'all';
        var viewLimits = { network: 50, list: 20 };
        var arcResizeObserver = null;
        var drawCurrentArcs = function () {};

        var host = panelEl.chart;
        host.innerHTML = '';
        host.classList.add('iwac-vis-associated', 'iwac-vis-graph-host');
        if (panelEl.panel && panelEl.panel.setAttribute) {
            panelEl.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        /* ---- Shared controls ----------------------------------------- */

        var controls = P.el('div', 'iwac-vis-associated__controls');

        var viewGroup = choiceGroup(P.t('View'), 'iwac-vis-associated__control--view');
        var viewButtons = {};
        [
            { key: 'network', label: P.t('Network view') },
            { key: 'list', label: P.t('Relational list') }
        ].forEach(function (option) {
            var button = choiceButton(option.label, function () {
                if (activeView === option.key) return;
                activeView = option.key;
                apply(true);
            });
            button.dataset.view = option.key;
            viewButtons[option.key] = button;
            viewGroup.choices.appendChild(button);
        });
        controls.appendChild(viewGroup.root);

        var typeGroup = choiceGroup(P.t('Entity type'), 'iwac-vis-associated__control--type');
        var typeButtons = {};
        ['all'].concat(TYPE_ORDER).forEach(function (type) {
            var label = type === 'all' ? P.t('All entities') : P.t('entity_type_' + type);
            var button = choiceButton('', function () {
                if (button.disabled || activeType === type) return;
                activeType = type;
                apply(true);
            });
            button.dataset.entityType = type;
            if (type !== 'all') {
                button.appendChild(P.el('span', 'iwac-vis-associated__swatch'));
            }
            button.appendChild(P.el('span', 'iwac-vis-associated__choice-label', label));
            button.appendChild(P.el('span', 'iwac-vis-associated__choice-count'));
            typeButtons[type] = button;
            typeGroup.choices.appendChild(button);
        });
        controls.appendChild(typeGroup.root);

        var limitControl = P.el('label', 'iwac-vis-associated__control iwac-vis-associated__control--limit');
        limitControl.appendChild(P.el('span', 'iwac-vis-associated__control-label', P.t('Number shown')));
        var limitSelect = P.el('select', 'iwac-vis-control iwac-vis-associated__limit');
        LIMITS.forEach(function (limit) {
            var option = P.el('option', null, String(limit));
            option.value = String(limit);
            limitSelect.appendChild(option);
        });
        limitSelect.addEventListener('change', function () {
            viewLimits[activeView] = parseInt(limitSelect.value, 10) || viewLimits[activeView];
            apply(true);
        });
        limitControl.appendChild(limitSelect);
        controls.appendChild(limitControl);
        host.appendChild(controls);

        /* ---- Two views + one empty state ----------------------------- */

        var graphHost = P.el('div', 'iwac-vis-associated__network');
        var listHost = P.el('div', 'iwac-vis-associated__list');
        var empty = P.buildEmptyState();
        empty.hidden = true;
        host.appendChild(graphHost);
        host.appendChild(listHost);
        host.appendChild(empty);

        var mounted = P.mountEntityGraph({ panel: panelEl.panel, chart: graphHost }, ctx, {
            variants: variants,
            showLegend: false,
            downloadName: 'iwac-associated-entities.png',
            ariaLabel: P.t('Network of the entities most associated with this record. Use the arrow keys to move between them and Enter to select one.')
        });

        function roleGraph() {
            return byRole[facet.role] || byRole.all || byRole[roles[0]];
        }

        function selectedGraph(unlimited) {
            var graph = graphForType(roleGraph(), activeType);
            return unlimited ? graph : limitGraph(graph, viewLimits[activeView]);
        }

        function paintTypes() {
            Object.keys(typeButtons).forEach(function (type) {
                if (type !== 'all') {
                    typeButtons[type].style.setProperty('--iwac-vis-entity-color', colorForType(type));
                }
            });
            var rows = listHost.querySelectorAll('[data-entity-type]');
            for (var i = 0; i < rows.length; i++) {
                rows[i].style.setProperty(
                    '--iwac-vis-entity-color',
                    colorForType(rows[i].dataset.entityType)
                );
            }
        }

        function refreshControls() {
            Object.keys(viewButtons).forEach(function (key) {
                var active = key === activeView;
                viewButtons[key].classList.toggle('iwac-vis-associated__choice--active', active);
                viewButtons[key].setAttribute('aria-pressed', String(active));
            });

            var currentRole = roleGraph();
            var counts = {};
            ['all'].concat(TYPE_ORDER).forEach(function (type) {
                counts[type] = neighboursOf(graphForType(currentRole, type)).length;
            });
            if (activeType !== 'all' && counts[activeType] === 0) activeType = 'all';

            Object.keys(typeButtons).forEach(function (type) {
                var active = type === activeType;
                var button = typeButtons[type];
                var count = counts[type] || 0;
                button.disabled = count === 0;
                button.classList.toggle('iwac-vis-associated__choice--active', active);
                button.setAttribute('aria-pressed', String(active));
                button.querySelector('.iwac-vis-associated__choice-count').textContent =
                    ' ' + P.formatNumber(count);
            });
            limitSelect.value = String(viewLimits[activeView]);
            paintTypes();
        }

        function renderArcList(graph) {
            if (arcResizeObserver) {
                arcResizeObserver.disconnect();
                arcResizeObserver = null;
            }
            listHost.innerHTML = '';

            var nodes = neighboursOf(graph);
            if (!nodes.length) return;
            var byId = {};
            nodes.forEach(function (node) { byId[String(node.o_id)] = node; });
            var edges = (graph.edges || []).filter(function (edge) {
                return edge.kind === 'cross' &&
                    byId[String(edge.source)] && byId[String(edge.target)];
            });

            var intro = P.el('p', 'iwac-vis-arc-list__intro',
                P.t('Ranked by distinctiveness. Curves connect entities that repeatedly appear together.'));
            listHost.appendChild(intro);

            var header = P.el('div', 'iwac-vis-arc-list__header');
            header.appendChild(P.el('span', null, P.t('Distinctiveness ranking')));
            header.appendChild(P.el('span', null, P.t('Mentions')));
            listHost.appendChild(header);

            var plot = P.el('div', 'iwac-vis-arc-list__plot');
            var svg = svgEl('svg', 'iwac-vis-arc-list__arcs');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            var list = P.el('ol', 'iwac-vis-arc-list__rows');
            plot.appendChild(svg);
            plot.appendChild(list);
            listHost.appendChild(plot);

            var rowsById = {};
            nodes.forEach(function (node, index) {
                var id = String(node.o_id);
                var row = P.el('li', 'iwac-vis-arc-list__row');
                row.dataset.nodeId = id;
                row.dataset.entityType = node.type || 'Sujets';
                row.style.setProperty('--iwac-vis-entity-color', colorForType(row.dataset.entityType));

                var rank = String(index + 1);
                if (rank.length < 2) rank = '0' + rank;
                row.appendChild(P.el('span', 'iwac-vis-arc-list__dot'));
                row.appendChild(P.el('span', 'iwac-vis-arc-list__rank', rank));

                var title = P.el('a', 'iwac-vis-arc-list__name', node.title || ('#' + node.o_id));
                title.href = ((ctx && ctx.siteBase) || '') + '/item/' + node.o_id;
                title.setAttribute('aria-label',
                    (node.title || ('#' + node.o_id)) + ', ' +
                    P.t('entity_type_' + (node.type || 'Sujets')) + ', ' +
                    P.t('mentions_count', { count: P.formatNumber(node.cooc || 0) }));
                row.appendChild(title);
                row.appendChild(P.el('span', 'iwac-vis-arc-list__type',
                    P.t('entity_type_' + (node.type || 'Sujets'))));
                row.appendChild(P.el('span', 'iwac-vis-arc-list__mentions',
                    P.formatNumber(node.cooc || 0)));
                list.appendChild(row);
                rowsById[id] = row;
            });

            var maxWeight = 1;
            edges.forEach(function (edge) {
                if ((edge.weight || 0) > maxWeight) maxWeight = edge.weight || 0;
            });
            var paths = [];
            edges.forEach(function (edge) {
                var path = svgEl('path', 'iwac-vis-arc-list__arc');
                path.dataset.source = String(edge.source);
                path.dataset.target = String(edge.target);
                var norm = Math.max(0, Math.min(1, (edge.weight || 0) / maxWeight));
                path.style.setProperty('--iwac-vis-arc-opacity', String(0.2 + Math.sqrt(norm) * 0.48));
                path.style.strokeWidth = String(1 + Math.sqrt(norm) * 2.25);
                svg.appendChild(path);
                paths.push(path);
            });

            function setHighlight(id) {
                var peers = {};
                paths.forEach(function (path) {
                    var connected = path.dataset.source === id || path.dataset.target === id;
                    path.classList.toggle('iwac-vis-arc-list__arc--active', connected);
                    path.classList.toggle('iwac-vis-arc-list__arc--quiet', !!id && !connected);
                    if (connected) {
                        peers[path.dataset.source] = true;
                        peers[path.dataset.target] = true;
                    }
                });
                Object.keys(rowsById).forEach(function (rowId) {
                    rowsById[rowId].classList.toggle('iwac-vis-arc-list__row--active', rowId === id);
                    rowsById[rowId].classList.toggle(
                        'iwac-vis-arc-list__row--peer', !!id && rowId !== id && !!peers[rowId]);
                });
            }

            Object.keys(rowsById).forEach(function (id) {
                var row = rowsById[id];
                row.addEventListener('mouseenter', function () { setHighlight(id); });
                row.addEventListener('mouseleave', function () { setHighlight(''); });
                row.addEventListener('focusin', function () { setHighlight(id); });
                row.addEventListener('focusout', function (event) {
                    if (!row.contains(event.relatedTarget)) setHighlight('');
                });
            });

            drawCurrentArcs = function () {
                var width = svg.clientWidth;
                var height = plot.clientHeight;
                if (!width || !height) return;
                svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
                var plotRect = plot.getBoundingClientRect();
                var endX = Math.max(8, width - 7);
                paths.forEach(function (path) {
                    var source = rowsById[path.dataset.source];
                    var target = rowsById[path.dataset.target];
                    if (!source || !target) return;
                    var sourceRect = source.getBoundingClientRect();
                    var targetRect = target.getBoundingClientRect();
                    var y1 = sourceRect.top - plotRect.top + sourceRect.height / 2;
                    var y2 = targetRect.top - plotRect.top + targetRect.height / 2;
                    var depth = Math.min(
                        Math.max(0, width - 14),
                        24 + Math.abs(y2 - y1) * 0.48
                    );
                    path.setAttribute('d',
                        'M ' + endX + ' ' + y1 +
                        ' C ' + (endX - depth) + ' ' + y1 + ', ' +
                        (endX - depth) + ' ' + y2 + ', ' +
                        endX + ' ' + y2);
                });
            };

            requestAnimationFrame(drawCurrentArcs);
            if (typeof ResizeObserver !== 'undefined') {
                arcResizeObserver = new ResizeObserver(drawCurrentArcs);
                arcResizeObserver.observe(plot);
            }
        }

        function apply(warm) {
            refreshControls();
            var graph = selectedGraph(false);
            var hasNodes = neighboursOf(graph).length > 0;

            host.classList.toggle('iwac-vis-associated--list', activeView === 'list');
            host.classList.toggle('iwac-vis-associated--empty', !hasNodes);
            empty.hidden = hasNodes;

            if (activeView === 'network') {
                graphHost.hidden = !hasNodes;
                listHost.hidden = true;
                if (mounted) {
                    var roleKey = byRole[facet.role] ? facet.role
                        : (byRole.all ? 'all' : roles[0]);
                    var ok = hasNodes && mounted.show(
                        graphKey(roleKey, activeType, viewLimits.network),
                        !!warm
                    );
                    if (!ok) mounted.clear();
                    graphHost.classList.toggle('iwac-vis-graph-host--empty', !ok);
                    if (ok) requestAnimationFrame(function () { mounted.graph.resize(); });
                }
            } else {
                graphHost.hidden = true;
                listHost.hidden = !hasNodes;
                if (hasNodes) renderArcList(graph);
                else listHost.innerHTML = '';
            }
        }

        apply(false);
        facet.subscribe(function () { apply(true); });

        // Plain DOM/SVG colours need the same live theme refresh as the
        // canvas. Geometry is preserved; only swatches and arc paint update.
        if (typeof ns.registerRenderer === 'function') {
            ns.registerRenderer(host, function () {
                paintTypes();
                drawCurrentArcs();
            });
        }
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = {
        render: render,
        graphForType: graphForType,
        limitGraph: limitGraph
    };
})();
