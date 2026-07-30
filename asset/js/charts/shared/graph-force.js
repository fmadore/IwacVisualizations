/**
 * IWAC Visualizations — ForceGraph: an interactive force-directed graph a
 * reader can actually handle. Drag a node and its neighbourhood relaxes
 * around it, and the node keeps the position you gave it.
 *
 * This file is the controller: the d3-force simulation, the pointer/keyboard
 * interaction, and the public surface the chrome drives. It draws nothing
 * itself — graph-canvas.js owns the view transform, the painter and the hit
 * tests, so the two concerns can change independently.
 *
 * Replaces the ECharts `graph`/`force` series for the item-page ego networks.
 * That series ran its layout to a frozen state (`layoutAnimation: false`,
 * which chart-options-graph.js needed so a resize or a merge-mode setOption
 * wouldn't re-animate the edges) with no collision pass: nodes overlapped,
 * labels could not be placed by importance, and dragging a node moved it
 * through a static picture instead of relaxing its neighbours.
 *
 * Layout: d3-force (Barnes–Hut many-body + collision + link springs), seeded
 * via `randomSource` so a given graph lays out identically on every load.
 *
 * Knows nothing about Omeka, entities or articles — it takes nodes, links and
 * a few style/behaviour hooks. Ported from AMIRA DREVisualizations v2.22.x.
 *
 * Depends on: iwac-theme.js, panels.js, graph-canvas.js, and d3-force 3 —
 * which the TEMPLATE must have declared (`needs: ['d3' => true]`).
 *
 * Usage:
 *   var graph = ns.ForceGraph.create(container, {
 *       nodes: [{ id, name, category, size, isCenter?, url?, data? }],
 *       categories: [{ name }],
 *       seed: 1234,
 *       colorOf: function (categoryIndex) { return '#ce4115'; },
 *       haloOf: function (node) { return '#8e2a4c' || null; },
 *       tooltip: function (node, link) { return [Element, …]; },
 *       announce: function (node) { return 'spoken description'; },
 *       forces: { distance, linkStrength, chargeOf }   // all optional
 *   });
 *   graph.setGraph({ nodes: [{id}, …], links: [{ source: id, target: id,
 *                    name, weight?, width?, alpha?, weak?, data? }] });
 *   graph.resize();
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !ns.GraphCanvas) {
        console.warn('IWACVis.ForceGraph: panels.js and graph-canvas.js must load first');
        return;
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /** Replace an element's children in one pass. */
    function setChildren(el, children) {
        while (el.firstChild) el.removeChild(el.firstChild);
        (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    }

    /**
     * Deterministic PRNG (mulberry32). d3-force seats nodes by phyllotaxis,
     * which is already deterministic, but forceCollide/forceLink `jiggle()`
     * coincident nodes through randomSource — seed that and the same data lays
     * out identically on every load, so the graph a reader shares is the graph
     * a reader returns to.
     */
    function makeRng(seed) {
        var a = (seed | 0) || 1;
        return function () {
            a = a + 0x6D2B79F5 | 0;
            var x = Math.imul(a ^ a >>> 15, 1 | a);
            x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
            return ((x ^ x >>> 14) >>> 0) / 4294967296;
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Default physics                                                    */
    /* ------------------------------------------------------------------ */

    var DEFAULT_FORCES = {
        /** Rest length of a link. Weak links sit further out; hubs get room. */
        distance: function (link, deg, scale) {
            var hub = Math.max(deg[link.source.id] || 1, deg[link.target.id] || 1);
            return ((link.weak ? 140 : 80) + Math.min(64, 3.4 * Math.sqrt(hub))) * scale;
        },
        /** d3's own 1/min(degree) damping, weakened for the softer links. */
        linkStrength: function (link, deg) {
            var m = Math.max(1, Math.min(deg[link.source.id] || 1, deg[link.target.id] || 1));
            return clamp((link.weak ? 0.45 : 1) / m, 0.008, 1);
        },
        /** Repulsion scaled by the node's own radius. */
        chargeOf: function (node, scale) {
            return -(30 + 9 * node.r) * scale;
        }
    };

    /** The node's own size, grown for well-connected hubs. */
    function radiusOf(n) {
        var size = n.isCenter
            ? n.size
            : Math.min(n.size * 2, n.size * (1 + 0.22 * Math.sqrt(Math.max(0, n.deg - 1))));
        return size / 2;
    }

    /* ------------------------------------------------------------------ */
    /*  Factory                                                            */
    /* ------------------------------------------------------------------ */

    function create(container, spec) {
        if (typeof d3 === 'undefined' || !d3.forceSimulation) {
            console.warn('IWACVis.ForceGraph: d3-force not loaded');
            return null;
        }
        var categories = spec.categories || [];
        var forces = Object.assign({}, DEFAULT_FORCES, spec.forces || {});
        var palette = (ns.getPalette && ns.getPalette()) || ['#ce4115'];
        var colorOf = spec.colorOf || function () { return palette[0]; };
        var haloOf = spec.haloOf || function () { return null; };
        var reduced = !!(ns.prefersReducedMotion && ns.prefersReducedMotion());
        var rng = makeRng(spec.seed || 1);

        // Node objects are created ONCE and reused across every setGraph call,
        // so a node that a filter hides and then reveals returns to where it was
        // rather than being flung in from a fresh phyllotaxis seat.
        var allNodes = (spec.nodes || []).map(function (n) {
            return {
                id: n.id, name: n.name || '', category: n.category || 0,
                size: n.size || 22, isCenter: !!n.isCenter,
                url: n.url || null, data: n.data || n,
                r: (n.size || 22) / 2, deg: 0, pinned: false
            };
        });
        var byId = {};
        allNodes.forEach(function (n) { byId[n.id] = n; });

        /* ---- DOM + canvas --------------------------------------------- */

        setChildren(container);
        container.classList.add('iwac-vis-graph-stage');

        var canvas = document.createElement('canvas');
        canvas.className = 'iwac-vis-graph-canvas';
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'application');
        canvas.setAttribute('aria-label', spec.ariaLabel
            || P.t('Network graph. Use the arrow keys to move between connected entities and Enter to select one.'));
        container.appendChild(canvas);

        var tooltip = P.el('div', 'iwac-vis-graph-tooltip');
        tooltip.hidden = true;
        container.appendChild(tooltip);

        var status = P.el('p', 'iwac-vis-graph-status');
        status.setAttribute('aria-live', 'polite');
        container.appendChild(status);

        var gc = ns.GraphCanvas.create(container, canvas);

        /* ---- State ---------------------------------------------------- */

        var pass = { nodes: [], links: [], deg: {}, adj: {} };
        var sim = null;
        var hoverId = null;       // node under the pointer (transient, desktop only)
        var hoverLink = null;     // link under the pointer (only when no node is)
        var focusId = null;       // keyboard focus
        var selectedId = null;    // the reader's anchor — persists until they clear it
        var showHalos = true;
        var labelsAll = false;
        var edgeLabels = false;
        var frozen = false;
        var hiddenCats = {};      // category index → true when toggled off
        var onPinChangeCb = null;
        var onThemeCb = null;
        var onSelectCb = null;

        function isVisible(n) { return !hiddenCats[n.category]; }
        function visibleNodes() { return pass.nodes.filter(isVisible); }
        function visibleLinks() {
            return pass.links.filter(function (l) { return isVisible(l.source) && isVisible(l.target); });
        }

        function pinnedCount() {
            var c = 0;
            for (var i = 0; i < allNodes.length; i++) if (allNodes[i].pinned) c++;
            return c;
        }
        function firePinChange() { if (onPinChangeCb) onPinChangeCb(pinnedCount()); }

        /**
         * The focus set: the anchor node plus its neighbours, everything else
         * dimmed.
         *
         * A selection outranks a hover, so moving the pointer away does not
         * throw away the neighbourhood the reader deliberately picked — that is
         * the whole point of selecting rather than hovering.
         */
        function focusSet() {
            var id = selectedId || hoverId || focusId;
            if (!id) return null;
            var set = {};
            set[id] = true;
            var nb = pass.adj[id] || {};
            for (var k in nb) set[k] = true;
            return set;
        }

        /** The snapshot graph-canvas.js paints from. */
        function scene() {
            return {
                nodes: visibleNodes(), links: visibleLinks(), categories: categories,
                colorOf: colorOf, haloOf: haloOf,
                hoverId: hoverId, focusId: focusId, selectedId: selectedId,
                hoverLink: hoverLink, focusSet: focusSet(),
                showHalos: showHalos, labelsAll: labelsAll, edgeLabels: edgeLabels
            };
        }

        /**
         * Make a node the reader's anchor (or clear it with null). Highlights
         * its neighbourhood, labels its edges, and hands it to the chrome so a
         * detail card can offer an explicit link — instead of a click silently
         * navigating away, which fought exploration and had no touch story.
         */
        function select(node) {
            var id = node ? node.id : null;
            if (id === selectedId) return;
            selectedId = id;
            hideTooltip();
            if (onSelectCb) onSelectCb(node || null);
            requestPaint();
        }

        var paintQueued = false;
        function requestPaint() {
            if (paintQueued) return;
            paintQueued = true;
            requestAnimationFrame(function () { paintQueued = false; gc.paint(scene()); });
        }

        function resize() {
            var changed = gc.resize();
            if (!gc.width() || !gc.height()) return;    // panel not laid out yet
            if (changed && !gc.isUserAdjusted()) gc.fit(visibleNodes());
            requestPaint();
        }

        /* ---- Simulation ----------------------------------------------- */

        /**
         * Swap in a new visible node/link set. Positions carry over, so a facet
         * change is a gentle re-settle rather than a fresh layout.
         *
         * @param {Object} graph {nodes: [{id}], links: [{source, target, …}]}
         * @param {boolean} warm true for an update, false for the first build
         */
        function setGraph(graph, warm) {
            var nodes = (graph.nodes || [])
                .map(function (n) { return byId[n && n.id != null ? n.id : n]; })
                .filter(Boolean);
            var present = {};
            nodes.forEach(function (n) { present[n.id] = true; });

            var deg = {};
            var links = [];
            (graph.links || []).forEach(function (l) {
                if (!present[l.source] || !present[l.target]) return;
                deg[l.source] = (deg[l.source] || 0) + 1;
                deg[l.target] = (deg[l.target] || 0) + 1;
                // Endpoints are resolved to node objects HERE: d3's forceLink
                // only runs its id lookup when an endpoint is not already an
                // object, so pre-resolving keeps the two sides in step with the
                // filter.
                links.push({
                    source: byId[l.source], target: byId[l.target], name: l.name || '',
                    weak: !!l.weak, width: l.width || 1.5, alpha: l.alpha || 0.6,
                    // Carried through unscaled (unlike `width`, which is already
                    // in px) so the chrome can rank a node's connections by the
                    // caller's own measure rather than by stroke thickness.
                    weight: l.weight || 0,
                    data: l.data || l
                });
            });

            var adj = {};
            links.forEach(function (l) {
                (adj[l.source.id] || (adj[l.source.id] = {}))[l.target.id] = l;
                (adj[l.target.id] || (adj[l.target.id] = {}))[l.source.id] = l;
            });

            nodes.forEach(function (n) {
                n.deg = deg[n.id] || 0;
                n.r = radiusOf(n);
                // The centre anchors the layout at the origin until the reader
                // drags it somewhere better.
                if (n.isCenter && n.fx === undefined && !n.pinned) { n.fx = 0; n.fy = 0; }
            });

            pass = { nodes: nodes, links: links, deg: deg, adj: adj };

            // Hover state points at objects from the OLD pass — a link a facet
            // just dropped would otherwise keep a tooltip open over a line that
            // is no longer drawn.
            hoverId = null;
            hoverLink = null;
            if (focusId && !present[focusId]) { focusId = null; announce(null); }
            if (selectedId && !present[selectedId]) select(null);
            hideTooltip();

            buildSimulation(nodes, links, deg, warm);
        }

        function buildSimulation(nodes, links, deg, warm) {
            var count = nodes.length;
            var dScale = count > 150 ? 0.78 : count > 80 ? 0.88 : 1;
            var cScale = count > 150 ? 0.7 : count > 80 ? 0.85 : 1;

            if (sim) sim.stop();
            sim = d3.forceSimulation(nodes)
                .randomSource(rng)
                .velocityDecay(0.42)
                .alphaDecay(0.028)
                .force('link', d3.forceLink(links)
                    .distance(function (l) { return forces.distance(l, deg, dScale); })
                    .strength(function (l) { return forces.linkStrength(l, deg); }))
                .force('charge', d3.forceManyBody()
                    .strength(function (n) { return forces.chargeOf(n, cScale); })
                    .distanceMax(count > 120 ? 700 : 1400))
                .force('collide', d3.forceCollide()
                    .radius(function (n) { return n.r + 4; })
                    .iterations(2))
                .force('x', d3.forceX(0).strength(0.018))
                .force('y', d3.forceY(0).strength(0.032))
                .stop();

            sim.on('tick', requestPaint);

            // Warm start: step without painting so the graph appears already
            // organised rather than exploding out of one point. Under
            // prefers-reduced-motion, settle it fully and never animate.
            var warmup = reduced ? 400 : (warm ? 34 : 78);
            for (var i = 0; i < warmup; i++) sim.tick();
            if (!reduced && !frozen) {
                if (warm) sim.alpha(0.32);
                sim.restart();
            }
        }

        /* ---- Tooltip -------------------------------------------------- */

        function hideTooltip() {
            tooltip.hidden = true;
            setChildren(tooltip);
        }

        function showTooltip(px, py, node, link) {
            var rows = spec.tooltip ? spec.tooltip(node, link) : null;
            if (!rows || !rows.length) { hideTooltip(); return; }
            setChildren(tooltip, rows);
            tooltip.hidden = false;
            // Confine to the stage, flipping side when the pointer nears an edge.
            var W = gc.width(), H = gc.height();
            var left = px + 14, top = py + 14;
            if (left + tooltip.offsetWidth > W - 6) left = Math.max(6, px - tooltip.offsetWidth - 14);
            if (top + tooltip.offsetHeight > H - 6) top = Math.max(6, py - tooltip.offsetHeight - 14);
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        }

        /* ---- Pointer interaction -------------------------------------- */

        var pointers = {};        // active pointerId → {x, y}
        var dragNode = null;
        var panning = false;
        var pressStart = null;    // {x, y, time, alt}
        var pinchStart = null;    // {dist, k, cx, cy}

        function localPos(ev) {
            var rect = canvas.getBoundingClientRect();
            return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        }

        function pointerPair() {
            var ids = Object.keys(pointers);
            return ids.length === 2 ? [pointers[ids[0]], pointers[ids[1]]] : null;
        }

        canvas.addEventListener('pointerdown', function (ev) {
            canvas.focus({ preventScroll: true });
            var p = localPos(ev);
            pointers[ev.pointerId] = p;

            var pair = pointerPair();
            if (pair) {
                // Second finger: switch from pan/drag to pinch-zoom.
                pinchStart = {
                    dist: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) || 1,
                    k: gc.view.k,
                    cx: (pair[0].x + pair[1].x) / 2, cy: (pair[0].y + pair[1].y) / 2
                };
                releaseDrag(false);
                panning = false;
                return;
            }

            var hit = sim ? gc.nodeAt(visibleNodes(), p.x, p.y) : null;
            pressStart = { x: p.x, y: p.y, time: performance.now(), alt: ev.altKey };
            if (hit) {
                dragNode = hit;
                hit.fx = hit.x; hit.fy = hit.y;
                if (!frozen && !reduced) sim.alphaTarget(0.22).restart();
            } else {
                panning = true;
                hideTooltip();
            }
            try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
            ev.preventDefault();
        });

        canvas.addEventListener('pointermove', function (ev) {
            var p = localPos(ev);
            var known = pointers[ev.pointerId];
            if (known) { known.x = p.x; known.y = p.y; }

            var pair = pinchStart && pointerPair();
            if (pair) {
                var dist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) || 1;
                var mid = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
                gc.pinch(pinchStart.k * (dist / pinchStart.dist),
                    { x: pinchStart.cx, y: pinchStart.cy }, mid);
                pinchStart.cx = mid.x; pinchStart.cy = mid.y;
                pinchStart.k = gc.view.k; pinchStart.dist = dist;
                requestPaint();
                return;
            }

            if (dragNode) {
                var w = gc.toWorld(p.x, p.y);
                dragNode.fx = w.x; dragNode.fy = w.y;
                if (frozen) {
                    sim.tick();                        // frozen means frozen
                } else if (reduced) {
                    // No animation loop under prefers-reduced-motion, so relax
                    // the neighbourhood synchronously — direct manipulation still
                    // has to respond, it just never animates on its own.
                    sim.alpha(Math.max(sim.alpha(), 0.12));
                    sim.tick(); sim.tick();
                }
                requestPaint();
                return;
            }
            if (panning && pressStart) {
                gc.panBy(p.x - pressStart.x, p.y - pressStart.y);
                pressStart.x = p.x; pressStart.y = p.y;
                requestPaint();
                return;
            }

            var hit = gc.nodeAt(visibleNodes(), p.x, p.y);
            var lnk = hit ? null : gc.linkAt(visibleLinks(), p.x, p.y);
            var changed = (hit ? hit.id : null) !== hoverId || lnk !== hoverLink;
            hoverId = hit ? hit.id : null;
            hoverLink = lnk;
            canvas.style.cursor = hit ? 'pointer' : (lnk ? 'help' : 'grab');
            if (hit || lnk) showTooltip(p.x, p.y, hit, lnk); else hideTooltip();
            if (changed) requestPaint();
        });

        function releaseDrag(keepPin) {
            if (!dragNode) return;
            if (keepPin) {
                dragNode.pinned = true;
            } else if (!dragNode.isCenter) {
                dragNode.fx = null; dragNode.fy = null;
            }
            dragNode = null;
            if (!frozen && !reduced) sim.alphaTarget(0);
            firePinChange();
        }

        function endPointer(ev) {
            delete pointers[ev.pointerId];
            if (Object.keys(pointers).length < 2) pinchStart = null;

            var wasDrag = dragNode;
            var start = pressStart;
            if (wasDrag && start) {
                var p = localPos(ev);
                if (Math.hypot(p.x - start.x, p.y - start.y) < 5 && performance.now() - start.time < 500) {
                    releaseDrag(false);                          // a click, not a drag
                    activate(wasDrag, start.alt);
                } else {
                    releaseDrag(true);                           // deliberate drag: it stays
                }
            } else {
                releaseDrag(false);
                // A click on empty canvas — not a pan — clears the anchor, the
                // same way Escape does. Distinguished by travel, like the node
                // click above.
                if (start && Math.hypot(localPos(ev).x - start.x, localPos(ev).y - start.y) < 5) {
                    select(null);
                }
            }
            panning = false;
            pressStart = null;
            requestPaint();
        }

        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('pointerleave', function () {
            if (!dragNode && !panning) { hoverId = null; hoverLink = null; hideTooltip(); requestPaint(); }
        });

        /**
         * Click / tap / Enter on a node. Alt-click releases a pin; otherwise the
         * node becomes the selection. It deliberately does NOT navigate: opening
         * the record is a second, explicit act on the real link in the detail
         * card, which works the same on a mouse and a finger and can be copied
         * or opened in a new tab. The old behaviour — jump straight to
         * /item/<o_id> — threw the graph away on the obvious "tell me more"
         * gesture.
         */
        function activate(node, alt) {
            if (alt) {
                node.pinned = false;
                if (node.isCenter) { node.fx = 0; node.fy = 0; } else { node.fx = null; node.fy = null; }
                firePinChange();
                if (sim && !frozen && !reduced) sim.alpha(0.2).restart(); else requestPaint();
                return;
            }
            select(node.id === selectedId ? null : node);   // clicking it again clears
        }

        // Double-click the background to zoom (Alt to zoom out) — the gesture
        // that spares readers the Ctrl+scroll discovery problem on a desktop.
        canvas.addEventListener('dblclick', function (ev) {
            var p = localPos(ev);
            if (gc.nodeAt(visibleNodes(), p.x, p.y)) return;
            if (gc.zoomAt(p.x, p.y, ev.altKey ? 1 / 1.5 : 1.5)) requestPaint();
            ev.preventDefault();
        });

        // Plain wheel keeps scrolling the page — the graph sits inside an item
        // page and hijacking the wheel there is the classic embedded-map trap.
        // Ctrl/⌘+wheel zooms, and in fullscreen there is no page to scroll so
        // the wheel is ours.
        canvas.addEventListener('wheel', function (ev) {
            if (!container.closest('.iwac-vis-panel--fullscreen') && !ev.ctrlKey && !ev.metaKey) return;
            ev.preventDefault();
            var p = localPos(ev);
            if (gc.zoomAt(p.x, p.y, ev.deltaY < 0 ? 1.12 : 1 / 1.12)) requestPaint();
        }, { passive: false });

        /* ---- Keyboard ------------------------------------------------- */

        /** Nodes in a stable reading order: centre first, then by degree. */
        function keyboardOrder() {
            return visibleNodes().sort(function (a, b) {
                if (a.isCenter !== b.isCenter) return a.isCenter ? -1 : 1;
                return (b.deg || 0) - (a.deg || 0) || a.name.localeCompare(b.name);
            });
        }

        function announce(node) {
            status.textContent = (node && spec.announce) ? spec.announce(node) : '';
        }

        // Tab is deliberately NOT handled: it must always take the reader out of
        // the canvas. Left/Right step through every node and set the "hub";
        // Up/Down then walk that hub's own neighbours. Holding the hub across an
        // Up/Down run is what makes the walk predictable — otherwise every step
        // would re-root on whatever it just landed on and wander off.
        var hubId = null;
        var neighbourCursor = -1;

        canvas.addEventListener('keydown', function (ev) {
            var order = keyboardOrder();
            if (!order.length) return;
            var idx = focusId ? order.findIndex(function (n) { return n.id === focusId; }) : -1;
            var next = null;

            if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                next = order[(idx + (ev.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
                hubId = next.id;
                neighbourCursor = -1;
            } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                if (!hubId) hubId = focusId || order[0].id;
                var nb = Object.keys(pass.adj[hubId] || {}).filter(function (id) {
                    return byId[id] && isVisible(byId[id]);
                });
                if (!nb.length) {
                    next = order[(idx + (ev.key === 'ArrowDown' ? 1 : -1) + order.length) % order.length];
                    hubId = next.id;
                } else {
                    neighbourCursor = (neighbourCursor + (ev.key === 'ArrowDown' ? 1 : -1) + nb.length) % nb.length;
                    next = byId[nb[neighbourCursor]];
                }
            } else if (ev.key === 'Enter' || ev.key === ' ') {
                if (focusId && byId[focusId]) { activate(byId[focusId], ev.altKey); ev.preventDefault(); }
                return;
            } else if (ev.key === '+' || ev.key === '=') {
                if (gc.zoomAt(gc.width() / 2, gc.height() / 2, 1.25)) requestPaint();
                ev.preventDefault(); return;
            } else if (ev.key === '-' || ev.key === '_') {
                if (gc.zoomAt(gc.width() / 2, gc.height() / 2, 1 / 1.25)) requestPaint();
                ev.preventDefault(); return;
            } else if (ev.key === '0') {
                gc.fit(visibleNodes()); requestPaint(); ev.preventDefault(); return;
            } else if (ev.key === 'Escape') {
                // Selection first, then keyboard focus: two Escapes to leave the
                // graph entirely, and neither one reaches the fullscreen handler
                // while there is still something in the graph to clear.
                if (selectedId) { select(null); ev.stopPropagation(); return; }
                if (focusId) { focusId = null; announce(null); requestPaint(); ev.stopPropagation(); }
                return;
            } else {
                return;
            }

            if (next) {
                focusId = next.id;
                gc.centerOn(next);
                announce(next);
                requestPaint();
                ev.preventDefault();
            }
        });

        canvas.addEventListener('blur', function () {
            focusId = null;
            hubId = null;
            neighbourCursor = -1;
            announce(null);
            requestPaint();
        });

        /* ---- Resize + theme ------------------------------------------- */

        if (window.ResizeObserver) {
            new ResizeObserver(function () { resize(); }).observe(container);
        } else {
            window.addEventListener('resize', resize);
        }

        // A light/dark toggle only needs a repaint with the freshly read tokens
        // — the layout must survive it, so this deliberately does not
        // re-simulate. Registered as a third `kind` in dashboard-core's chart
        // registry so it rides the same body[data-theme] observer as ECharts
        // and MapLibre.
        var registration = null;
        if (typeof ns.registerRenderer === 'function') {
            registration = ns.registerRenderer(container, function () {
                palette = (ns.getPalette && ns.getPalette()) || palette;
                gc.paint(scene());
                if (onThemeCb) onThemeCb();
            });
        }

        /* ---- Public surface ------------------------------------------- */

        return {
            setGraph: function (graph, warm) { setGraph(graph, warm); requestPaint(); },
            resize: resize,
            repaint: requestPaint,
            resetView: function () { gc.fit(visibleNodes()); requestPaint(); },
            zoomBy: function (factor) {
                if (gc.zoomAt(gc.width() / 2, gc.height() / 2, factor)) requestPaint();
            },
            categoriesInUse: function () {
                var used = {};
                pass.nodes.forEach(function (n) { used[n.category] = true; });
                return used;
            },
            toggleCategory: function (i, visible) {
                if (visible) delete hiddenCats[i]; else hiddenCats[i] = true;
                hideTooltip();
                requestPaint();
            },
            isCategoryVisible: function (i) { return !hiddenCats[i]; },
            toggleHalos: function () { showHalos = !showHalos; requestPaint(); return showHalos; },
            toggleLabels: function () { labelsAll = !labelsAll; requestPaint(); return labelsAll; },
            toggleFrozen: function () {
                frozen = !frozen;
                if (!sim) return frozen;
                if (frozen) sim.stop(); else if (!reduced) sim.alpha(0.2).restart();
                return frozen;
            },
            unpinAll: function () {
                allNodes.forEach(function (n) {
                    n.pinned = false;
                    if (n.isCenter) { n.fx = 0; n.fy = 0; } else { n.fx = null; n.fy = null; }
                });
                firePinChange();
                if (sim && !frozen && !reduced) sim.alpha(0.3).restart(); else requestPaint();
            },
            toggleEdgeLabels: function () { edgeLabels = !edgeLabels; requestPaint(); return edgeLabels; },
            select: function (id) { select(id != null ? byId[id] || null : null); },
            selected: function () { return selectedId != null ? byId[selectedId] : null; },
            onSelect: function (cb) { onSelectCb = cb; },
            onPinChange: function (cb) { onPinChangeCb = cb; },
            onTheme: function (cb) { onThemeCb = cb; },
            pinnedCount: pinnedCount,
            reducedMotion: reduced,
            visibleNodes: visibleNodes,
            adjacency: function () { return pass.adj; },
            neighbours: function (id) {
                var out = [];
                var nb = pass.adj[id] || {};
                for (var k in nb) {
                    if (byId[k] && isVisible(byId[k])) out.push({ node: byId[k], link: nb[k] });
                }
                return out;
            },
            toDataURL: function () { return gc.exportPng(scene()); },
            dispose: function () {
                if (sim) sim.stop();
                if (registration && registration.remove) registration.remove();
            }
        };
    }

    ns.ForceGraph = {
        create: create,
        makeRng: makeRng,
        DEFAULT_FORCES: DEFAULT_FORCES,
        radiusOf: radiusOf
    };
})();
