/**
 * IWAC Visualizations — Force-graph panel chrome.
 *
 * Everything a reader touches around a `ns.ForceGraph` canvas: the toolbar,
 * the clickable legend, and the selection card. Split from the renderer so
 * graph-force.js stays a renderer — this file only ever talks to a ForceGraph
 * through its public surface (setGraph, toggleLabels, select, …), never to its
 * internals.
 *
 * `P.mountForceGraph` is the whole API. It owns the DOM inside the panel's
 * chart host, so a panel module reduces to "build nodes/links, hand them over,
 * describe a node".
 *
 * Why a selection card rather than click-to-navigate: the ECharts panels this
 * replaces jumped straight to `/item/<o_id>` on click, which threw the graph
 * away on the obvious "tell me more" gesture and had no touch story at all
 * (a tap IS a click). Selecting anchors the neighbourhood, names the shared
 * connections, and offers the record as an explicit link the reader can
 * middle-click, copy or ignore.
 *
 * Depends on: panels.js (P.el, P.t, P.formatNumber), graph-force.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !ns.ForceGraph) {
        console.warn('IWACVis.graph-panel: panels.js and graph-force.js must load first');
        return;
    }

    var t = P.t;
    var fmt = P.formatNumber;

    /**
     * "N connections", with the singular spelled out.
     *
     * Both languages need the special case (1 connection / 1 lien), and both
     * the card heading and the screen-reader announcement say it, so it lives
     * here rather than being duplicated with a plural-s bug in each.
     */
    P.connectionsLabel = function (n) {
        return n === 1 ? t('one_connection') : t('connections_count', { count: fmt(n) });
    };

    /* ------------------------------------------------------------------ */
    /*  Toolbar                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * The vertical icon column, top-right of the stage. Glyphs and classes
     * match `P.buildGraphPanelToolbar` (the ECharts graphs' toolbar) so the two
     * families stay visually identical while both exist.
     */
    function buildToolbar(graph, panelEl, opts) {
        var bar = P.el('div', 'iwac-vis-graph-toolbar');

        function btn(label, title, onClick) {
            var b = P.el('button', 'iwac-vis-btn iwac-vis-graph-toolbar__btn', label);
            b.type = 'button';
            b.setAttribute('aria-label', title);
            b.title = title;
            b.addEventListener('click', onClick);
            bar.appendChild(b);
            return b;
        }
        /** A toggle whose pressed state mirrors what the graph reports back. */
        function toggle(label, title, fn) {
            var b = btn(label, title, function () {
                var on = fn();
                b.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', !!on);
                b.setAttribute('aria-pressed', String(!!on));
            });
            b.setAttribute('aria-pressed', 'false');
            return b;
        }

        btn('+', t('Zoom in'), function () { graph.zoomBy(1.4); });
        btn('−', t('Zoom out'), function () { graph.zoomBy(1 / 1.4); });
        btn('↺', t('Reset view'), function () { graph.resetView(); });
        toggle('A', t('Show all labels'), function () { return graph.toggleLabels(); });
        toggle('↔', t('Name the connections'), function () { return graph.toggleEdgeLabels(); });
        toggle('❄', t('Freeze the layout'), function () { return graph.toggleFrozen(); });

        // Only meaningful once the reader has dragged something into place, so
        // it appears then and leaves when the last pin is released.
        var unpinBtn = btn('⊘', t('Release the nodes you moved'), function () { graph.unpinAll(); });
        unpinBtn.hidden = true;
        graph.onPinChange(function (count) { unpinBtn.hidden = (count === 0); });

        btn('⭳', t('Download chart'), function () {
            var dataUrl = graph.toDataURL();
            if (!dataUrl) return;
            var a = document.createElement('a');
            a.download = opts.downloadName || 'iwac-graph.png';
            a.href = dataUrl;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        var fullBtn = btn('⛶', t('Toggle fullscreen'), function () {
            var host = panelEl.panel;
            if (!host) return;
            if (!document.fullscreenElement) {
                if (host.requestFullscreen) host.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });

        // Self-cleaning (same rule as panel-toolbar.js): a panel that has
        // left the document drops its listener on the next change.
        var onFullscreenChange = function () {
            var host = panelEl.panel;
            if (!host || !document.body.contains(host)) {
                document.removeEventListener('fullscreenchange', onFullscreenChange);
                return;
            }
            var isFull = (document.fullscreenElement === host);
            host.classList.toggle('iwac-vis-panel--fullscreen', isFull);
            fullBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', isFull);
            // Give the browser a frame to apply the new size. The graph's own
            // ResizeObserver usually beats us to it; this is the belt-and-braces
            // path for browsers that don't fire it on a fullscreen transition.
            // A deliberate re-fit is NOT forced here: if the reader had zoomed
            // in, that zoom is theirs to keep (Reset view is one click away).
            setTimeout(function () { graph.resize(); }, 50);
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);

        return bar;
    }

    /* ------------------------------------------------------------------ */
    /*  Legend                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Category chips below the stage, in flow — not an overlay, so they never
     * cover a node. Clicking one hides that category; the swatch keeps the
     * colour the painter uses so the mapping is never in doubt.
     *
     * Rebuilt on every graph swap: a facet flip can change which categories are
     * present, and a legend entry for an absent type is a dead control.
     */
    function buildLegend(graph, categories, colorOf) {
        var bar = P.el('div', 'iwac-vis-graph-legend');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', t('Filter by entity type'));

        function refresh() {
            var used = graph.categoriesInUse();
            while (bar.firstChild) bar.removeChild(bar.firstChild);
            categories.forEach(function (cat, i) {
                // The centre is category 0 and is never hideable — losing it
                // would leave a graph with no anchor and no way back.
                if (i === 0 || !used[i]) return;
                var chip = P.el('button', 'iwac-vis-graph-legend__item');
                chip.type = 'button';
                var visible = graph.isCategoryVisible(i);
                chip.setAttribute('aria-pressed', String(visible));
                chip.classList.toggle('iwac-vis-graph-legend__item--off', !visible);
                var swatch = P.el('span', 'iwac-vis-graph-legend__swatch');
                swatch.style.background = colorOf(i);
                chip.appendChild(swatch);
                chip.appendChild(P.el('span', null, cat.name));
                chip.addEventListener('click', function () {
                    var next = !graph.isCategoryVisible(i);
                    graph.toggleCategory(i, next);
                    chip.setAttribute('aria-pressed', String(next));
                    chip.classList.toggle('iwac-vis-graph-legend__item--off', !next);
                });
                bar.appendChild(chip);
            });
            bar.hidden = !bar.firstChild;
        }

        return { el: bar, refresh: refresh };
    }

    /* ------------------------------------------------------------------ */
    /*  Selection card                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * The panel that opens when a reader selects a node: what it is, how it
     * connects here, and a link to its record.
     *
     * `spec.cardRows(node)` supplies the caller's own facts (mentions,
     * distinctiveness, shared items…); the connections list is derived from the
     * live adjacency so it always describes what is actually drawn.
     */
    function buildCard(graph, spec) {
        var card = P.el('div', 'iwac-vis-graph-card');
        card.hidden = true;

        function close() { graph.select(null); }

        function render(node) {
            while (card.firstChild) card.removeChild(card.firstChild);
            if (!node) { card.hidden = true; return; }

            var closeBtn = P.el('button', 'iwac-vis-graph-card__close', '×');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', t('Close'));
            closeBtn.addEventListener('click', close);
            card.appendChild(closeBtn);

            card.appendChild(P.el('h4', 'iwac-vis-graph-card__title', node.name));

            var kind = spec.categoryName ? spec.categoryName(node) : null;
            if (kind) card.appendChild(P.el('p', 'iwac-vis-graph-card__kind', kind));

            var rows = (spec.cardRows && spec.cardRows(node)) || [];
            if (rows.length) {
                var dl = P.el('dl', 'iwac-vis-graph-card__facts');
                rows.forEach(function (row) {
                    dl.appendChild(P.el('dt', null, row.label));
                    dl.appendChild(P.el('dd', null, row.value));
                });
                card.appendChild(dl);
            }

            // Strongest connections first — the reader asked about this node, so
            // rank its neighbours the way the graph itself weights them.
            var nb = graph.neighbours(node.id).sort(function (a, b) {
                return (b.link.weight || 0) - (a.link.weight || 0);
            });
            if (nb.length) {
                card.appendChild(P.el('p', 'iwac-vis-graph-card__label',
                    P.connectionsLabel(nb.length)));
                var ul = P.el('ul', 'iwac-vis-graph-card__links');
                nb.slice(0, 6).forEach(function (entry) {
                    var li = document.createElement('li');
                    var jump = P.el('button', 'iwac-vis-graph-card__jump', entry.node.name);
                    jump.type = 'button';
                    // Selecting the neighbour walks the graph without leaving it —
                    // the exploration gesture the old click-to-navigate removed.
                    jump.addEventListener('click', function () { graph.select(entry.node.id); });
                    li.appendChild(jump);
                    if (entry.link.name) {
                        li.appendChild(P.el('span', 'iwac-vis-graph-card__weight', entry.link.name));
                    }
                    ul.appendChild(li);
                });
                card.appendChild(ul);
                if (nb.length > 6) {
                    card.appendChild(P.el('p', 'iwac-vis-graph-card__more',
                        t('and_n_more', { count: fmt(nb.length - 6) })));
                }
            }

            var url = spec.itemUrl ? spec.itemUrl(node) : node.url;
            if (url) {
                var a = P.el('a', 'iwac-vis-graph-card__open', t('Open the record'));
                a.href = url;
                card.appendChild(a);
            }

            card.hidden = false;
        }

        return { el: card, render: render };
    }

    /* ------------------------------------------------------------------ */
    /*  Mount                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Replace a panel's chart host with a canvas force graph plus its chrome.
     *
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl
     * @param {Object} spec
     * @param {Array}  spec.nodes        every node that can ever appear
     *   ({ id, name, category, size, isCenter?, url?, data? })
     * @param {Array}  spec.categories   [{ name }] — index 0 is the centre
     * @param {number} [spec.seed]       deterministic layout seed
     * @param {function(number):string} [spec.colorOf]
     * @param {function(Object, Object):Array<Node>} [spec.tooltip]
     * @param {function(Object):Array<{label,value}>} [spec.cardRows]
     * @param {function(Object):string} [spec.categoryName]
     * @param {function(Object):string} [spec.itemUrl]
     * @param {function(Object):string} [spec.announce]
     * @param {string} [spec.downloadName]
     * @returns {{graph: Object, setGraph: function(Object, boolean): void}|null}
     */
    P.mountForceGraph = function (panelEl, spec) {
        spec = spec || {};
        var host = panelEl.chart;

        // `.iwac-vis-graph-host` already carries the 640px floor, the fullscreen
        // height and the shared-toolbar opt-out that the ECharts graphs use;
        // `--force` adds the flex column this renderer needs WITHOUT touching
        // the ECharts panels (references-overview, semantic-landscape) that
        // share the first class.
        host.classList.add('iwac-vis-graph-host', 'iwac-vis-graph-host--force');
        if (panelEl.panel && panelEl.panel.setAttribute) {
            panelEl.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }
        while (host.firstChild) host.removeChild(host.firstChild);

        // ForceGraph tags this element `.iwac-vis-graph-stage` itself (it has
        // to — it owns the canvas positioned against it), so the div is
        // created bare and the renderer names it.
        var stage = P.el('div');
        host.appendChild(stage);

        var palette = (ns.getPalette && ns.getPalette()) || ['#ce4115'];
        var categories = spec.categories || [];
        var colorOf = spec.colorOf || function (i) { return palette[i % palette.length]; };

        var graph = ns.ForceGraph.create(stage, {
            nodes: spec.nodes,
            categories: categories,
            seed: spec.seed,
            colorOf: colorOf,
            tooltip: spec.tooltip,
            announce: spec.announce,
            ariaLabel: spec.ariaLabel,
            forces: spec.forces
        });
        if (!graph) {
            // d3-force missing: a real failure (the template forgot
            // `needs['d3']`, or the CDN is unreachable), not an empty slice.
            host.appendChild(P.buildErrorState());
            return null;
        }

        // Some panels provide a stronger, shared type control above both a
        // graph and an alternate reading view. In that case the control is
        // already the legend and rendering a second row of category toggles
        // would present two different filtering models for the same data.
        var legend = spec.showLegend === false
            ? { el: null, refresh: function () {} }
            : buildLegend(graph, categories, colorOf);
        if (legend.el) host.appendChild(legend.el);

        var card = buildCard(graph, spec);
        stage.appendChild(card.el);

        host.appendChild(buildToolbar(graph, panelEl, spec));

        graph.onSelect(function (node) { card.render(node); });
        // A theme swap re-reads the palette, so the legend swatches have to be
        // repainted with it — the canvas gets that for free via registerRenderer.
        graph.onTheme(function () {
            palette = (ns.getPalette && ns.getPalette()) || palette;
            legend.refresh();
        });

        return {
            graph: graph,
            setGraph: function (g, warm) {
                graph.setGraph(g, warm);
                legend.refresh();
                // The stage is laid out by now (the panel is on screen), so this
                // is what gives the first paint a fitted view.
                graph.resize();
            }
        };
    };
})();
