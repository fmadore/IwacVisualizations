/**
 * IWAC Visualizations — Person + Entity Dashboards: Associated entities
 *
 * One analysis, three reading modes:
 *
 *   - Network: the existing live canvas force graph for finding clusters.
 *   - Relational list: an exact TF-IDF ranking whose left-hand arcs retain
 *     the neighbour↔neighbour co-occurrence structure.
 *   - Over time: the same ranking as a period matrix, with raw shared-item
 *     counts in each cell and undated source items disclosed explicitly.
 *
 * A shared single-choice entity-type filter and per-view top-N control drive
 * all three. Since payload version 3 each type is ranked from the full scored pool
 * under `by_type`; older bundles still work by filtering their mixed
 * root top 50 client-side (necessarily a weaker answer, but never a crash).
 * Payload version 4 adds sparse yearly counts under `over_time`. The third
 * view is simply omitted for older payloads.
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

    function timeDataOf(roleGraph) {
        return roleGraph && roleGraph.over_time ? roleGraph.over_time : null;
    }

    function hasTemporalData(temporal) {
        var entities = temporal && temporal.entities;
        if (!entities) return false;
        return Object.keys(entities).some(function (id) {
            return (entities[id] || []).some(function (point) {
                return Array.isArray(point) && Number(point[1]) > 0;
            });
        });
    }

    function buildPeriods(temporal, requestedSize) {
        var size = requestedSize === 10 ? 10 : 5;
        var years = [];
        var hasMin = temporal && temporal.year_min !== null && temporal.year_min !== undefined;
        var hasMax = temporal && temporal.year_max !== null && temporal.year_max !== undefined;
        var min = hasMin ? Number(temporal.year_min) : NaN;
        var max = hasMax ? Number(temporal.year_max) : NaN;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            var entities = (temporal && temporal.entities) || {};
            Object.keys(entities).forEach(function (id) {
                (entities[id] || []).forEach(function (point) {
                    var year = Number(point && point[0]);
                    if (Number.isFinite(year)) years.push(year);
                });
            });
            if (!years.length) return [];
            min = Math.min.apply(null, years);
            max = Math.max.apply(null, years);
        }
        var first = Math.floor(min / size) * size;
        var last = Math.floor(max / size) * size;
        var periods = [];
        for (var start = first; start <= last; start += size) {
            var end = start + size - 1;
            periods.push({
                start: start,
                end: end,
                label: size === 10
                    ? String(start) + 's'
                    : String(start) + '\u2013' + String(end).slice(-2),
                fullLabel: String(start) + '\u2013' + String(end)
            });
        }
        return periods;
    }

    /** Build a presentation-neutral period matrix in the graph's rank order. */
    function buildTimeMatrix(graph, temporal, periodSize) {
        var periods = buildPeriods(temporal, periodSize);
        var periodIndex = {};
        periods.forEach(function (period, index) {
            periodIndex[String(period.start)] = index;
        });
        var entities = (temporal && temporal.entities) || {};
        var maxCount = 0;
        var rows = neighboursOf(graph).map(function (node) {
            var values = periods.map(function () { return 0; });
            (entities[String(node.o_id)] || []).forEach(function (point) {
                var year = Number(point && point[0]);
                var count = Number(point && point[1]);
                if (!Number.isFinite(year) || !Number.isFinite(count) || count <= 0) return;
                var start = Math.floor(year / (periodSize === 10 ? 10 : 5)) *
                    (periodSize === 10 ? 10 : 5);
                var index = periodIndex[String(start)];
                if (index === undefined) return;
                values[index] += count;
                if (values[index] > maxCount) maxCount = values[index];
            });
            return {
                node: node,
                values: values,
                total: values.reduce(function (sum, count) { return sum + count; }, 0)
            };
        });
        return {
            periods: periods,
            rows: rows,
            maxCount: maxCount,
            datedItems: Number((temporal && temporal.dated_items) || 0),
            undatedItems: Number((temporal && temporal.undated_items) || 0)
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
        var hasTemporalView = roles.some(function (role) {
            return hasTemporalData(timeDataOf(byRole[role]));
        });
        var activeView = 'network';
        var activeType = 'all';
        var viewLimits = { network: 50, list: 20, time: 10 };
        var periodSize = 5;
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
        var viewOptions = [
            { key: 'network', label: P.t('Network view') },
            { key: 'list', label: P.t('Relational list') }
        ];
        if (hasTemporalView) viewOptions.push({ key: 'time', label: P.t('Over time') });
        viewOptions.forEach(function (option) {
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

        var periodControl = P.el('label', 'iwac-vis-associated__control iwac-vis-associated__control--period');
        periodControl.appendChild(P.el('span', 'iwac-vis-associated__control-label', P.t('Period')));
        var periodSelect = P.el('select', 'iwac-vis-control iwac-vis-associated__period');
        [
            { value: 5, label: P.t('Five-year periods') },
            { value: 10, label: P.t('Decades') }
        ].forEach(function (period) {
            var option = P.el('option', null, period.label);
            option.value = String(period.value);
            periodSelect.appendChild(option);
        });
        periodSelect.addEventListener('change', function () {
            periodSize = parseInt(periodSelect.value, 10) === 10 ? 10 : 5;
            apply(true);
        });
        periodControl.appendChild(periodSelect);
        periodControl.hidden = true;
        controls.appendChild(periodControl);
        host.appendChild(controls);

        /* ---- Three views + one empty state --------------------------- */

        var graphHost = P.el('div', 'iwac-vis-associated__network');
        var listHost = P.el('div', 'iwac-vis-associated__list');
        var timeHost = P.el('div', 'iwac-vis-associated__time');
        var empty = P.buildEmptyState();
        empty.hidden = true;
        host.appendChild(graphHost);
        host.appendChild(listHost);
        host.appendChild(timeHost);
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
            var rows = host.querySelectorAll('[data-entity-type]');
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
            periodControl.hidden = activeView !== 'time';
            periodSelect.value = String(periodSize);
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

        function renderTimeMatrix(graph, temporal) {
            timeHost.innerHTML = '';
            var matrix = buildTimeMatrix(graph, temporal, periodSize);
            if (!matrix.rows.length || !matrix.periods.length) return;

            timeHost.appendChild(P.el(
                'p',
                'iwac-vis-time-matrix__intro',
                P.t('Rows retain the overall distinctiveness ranking. Each cell counts shared items with a readable year.')
            ));

            var notes = P.el('div', 'iwac-vis-time-matrix__notes');
            notes.appendChild(P.el(
                'span',
                'iwac-vis-time-matrix__key',
                P.t('Darker cells represent more shared items.')
            ));
            if (matrix.undatedItems > 0) {
                notes.appendChild(P.el(
                    'span',
                    'iwac-vis-time-matrix__caveat',
                    P.t('Items without a readable year are omitted: {count}.', {
                        count: P.formatNumber(matrix.undatedItems)
                    })
                ));
            }
            timeHost.appendChild(notes);

            var scroll = P.el('div', 'iwac-vis-time-matrix__scroll');
            scroll.tabIndex = 0;
            scroll.setAttribute('role', 'region');
            scroll.setAttribute('aria-label', P.t('Associated entities over time'));
            var table = P.el('table', 'iwac-vis-time-matrix__table');
            var caption = P.el('caption', 'iwac-vis-time-matrix__caption',
                P.t('Associated entities over time'));
            table.appendChild(caption);

            var thead = document.createElement('thead');
            var headRow = document.createElement('tr');
            var entityHead = P.el('th', 'iwac-vis-time-matrix__entity-head',
                P.t('Distinctiveness ranking'));
            entityHead.scope = 'col';
            headRow.appendChild(entityHead);
            matrix.periods.forEach(function (period) {
                var th = P.el('th', 'iwac-vis-time-matrix__period-head');
                th.scope = 'col';
                var abbr = P.el('abbr', null, period.label);
                abbr.title = period.fullLabel;
                th.appendChild(abbr);
                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');
            matrix.rows.forEach(function (rowData, index) {
                var node = rowData.node;
                var type = node.type || 'Sujets';
                var tr = document.createElement('tr');
                tr.dataset.entityType = type;

                var entity = P.el('th', 'iwac-vis-time-matrix__entity');
                entity.scope = 'row';
                entity.dataset.entityType = type;
                entity.style.setProperty('--iwac-vis-entity-color', colorForType(type));
                entity.appendChild(P.el('span', 'iwac-vis-time-matrix__dot'));
                var rank = String(index + 1);
                if (rank.length < 2) rank = '0' + rank;
                entity.appendChild(P.el('span', 'iwac-vis-time-matrix__rank', rank));
                var name = P.el('a', 'iwac-vis-time-matrix__name',
                    node.title || ('#' + node.o_id));
                name.href = ((ctx && ctx.siteBase) || '') + '/item/' + node.o_id;
                name.setAttribute('aria-label',
                    (node.title || ('#' + node.o_id)) + ', ' +
                    P.t('entity_type_' + type) + ', ' +
                    P.t('mentions_count', { count: P.formatNumber(node.cooc || 0) }));
                entity.appendChild(name);
                var mentions = P.el('span', 'iwac-vis-time-matrix__mentions',
                    P.formatNumber(node.cooc || 0));
                mentions.title = P.t('Overall mentions');
                entity.appendChild(mentions);
                tr.appendChild(entity);

                rowData.values.forEach(function (count, periodIndex) {
                    var period = matrix.periods[periodIndex];
                    var cell = P.el('td', 'iwac-vis-time-matrix__cell');
                    cell.dataset.entityType = type;
                    cell.style.setProperty('--iwac-vis-entity-color', colorForType(type));
                    var opacity = count > 0 && matrix.maxCount > 0
                        ? 0.14 + Math.sqrt(count / matrix.maxCount) * 0.72
                        : 0;
                    cell.style.setProperty('--iwac-vis-time-opacity', String(opacity));
                    cell.classList.toggle('iwac-vis-time-matrix__cell--zero', count === 0);
                    cell.textContent = count ? P.formatNumber(count) : '\u2014';
                    cell.setAttribute('aria-label', P.t('shared_items_in_period', {
                        count: P.formatNumber(count),
                        period: period.fullLabel
                    }));
                    tr.appendChild(cell);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            scroll.appendChild(table);
            timeHost.appendChild(scroll);
            paintTypes();
        }

        function apply(warm) {
            refreshControls();
            var graph = selectedGraph(false);
            var hasNodes = neighboursOf(graph).length > 0;
            var temporal = timeDataOf(roleGraph());
            var hasVisibleData = hasNodes &&
                (activeView !== 'time' || hasTemporalData(temporal));

            host.classList.toggle('iwac-vis-associated--list', activeView === 'list');
            host.classList.toggle('iwac-vis-associated--time', activeView === 'time');
            host.classList.toggle('iwac-vis-associated--empty', !hasVisibleData);
            empty.hidden = hasVisibleData;

            if (activeView === 'network') {
                graphHost.hidden = !hasVisibleData;
                listHost.hidden = true;
                timeHost.hidden = true;
                if (mounted) {
                    var roleKey = byRole[facet.role] ? facet.role
                        : (byRole.all ? 'all' : roles[0]);
                    var ok = hasVisibleData && mounted.show(
                        graphKey(roleKey, activeType, viewLimits.network),
                        !!warm
                    );
                    if (!ok) mounted.clear();
                    graphHost.classList.toggle('iwac-vis-graph-host--empty', !ok);
                    if (ok) requestAnimationFrame(function () { mounted.graph.resize(); });
                }
            } else if (activeView === 'list') {
                graphHost.hidden = true;
                listHost.hidden = !hasVisibleData;
                timeHost.hidden = true;
                if (hasVisibleData) renderArcList(graph);
                else listHost.innerHTML = '';
            } else {
                graphHost.hidden = true;
                listHost.hidden = true;
                timeHost.hidden = !hasVisibleData;
                if (hasVisibleData) renderTimeMatrix(graph, temporal);
                else timeHost.innerHTML = '';
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
        limitGraph: limitGraph,
        buildTimeMatrix: buildTimeMatrix
    };
})();
