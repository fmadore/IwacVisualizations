/**
 * IWAC Visualizations — GraphCanvas: view transform, painter and hit tests
 * for a node-link canvas. Everything that turns graph coordinates into
 * pixels, and pixels back into a node.
 *
 * Deliberately knows nothing about d3, simulations, Omeka or ECharts: hand
 * it a *scene* (visible nodes and links, plus the focus/label flags) and it
 * draws. That boundary is what lets one painter serve the live canvas AND
 * the 2× PNG export, and lets graph-force.js stay a controller.
 *
 * Coordinates: nodes carry world-space `x`/`y`; screen = world · k + (x, y).
 * The transform lives here and the simulation never sees it, so panning and
 * zooming cannot move a node, and a re-settle cannot yank the viewport.
 *
 * Colors come from `ns.getChartTokens()` on every paint, so a light/dark
 * toggle is a repaint — no re-simulation, no hardcoded hex. Ported from the
 * AMIRA DREVisualizations renderer (v2.22.x), which was debugged against a
 * live Omeka site; the fullscreen sizing guard in `resize()` and the
 * collision budget in `drawLabels()` both come from that round.
 *
 * Depends on: iwac-theme.js (ns.getChartTokens).
 *
 * A scene is:
 *   { nodes, links,                  // already visibility-filtered
 *     categories, colorOf, haloOf,   // style hooks
 *     hoverId, focusId, selectedId, hoverLink, focusSet,
 *     showHalos, labelsAll, edgeLabels }
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    var MIN_ZOOM = 0.2;
    var MAX_ZOOM = 6;
    var LABEL_BUDGET = 46;      // labels drawn before the painter stops trying
    var LABEL_MAX_LEN = 24;     // matches C._truncate's cutoff in the ECharts charts
    var HIT_SLOP = 3;           // px added to a node's radius when hit testing
    var LINK_HIT = 36;          // 6px, squared

    /**
     * Middle-ellipsis truncation, same shape as `C._truncate` so a label
     * reads identically whether it was drawn here or by an ECharts panel.
     */
    function truncate(str, maxLen) {
        if (!str || str.length <= maxLen) return str || '';
        var head = Math.floor((maxLen - 1) / 2);
        var tail = maxLen - 1 - head;
        return str.slice(0, head) + '…' + str.slice(-tail);
    }

    /**
     * The painter's colour vocabulary, resolved from the live IWAC tokens.
     * Read fresh per paint: `ns.getChartTokens()` returns the last-refreshed
     * token object, which dashboard-core rebuilds on every theme swap.
     */
    function theme() {
        var k = (ns.getChartTokens && ns.getChartTokens()) || {};
        return {
            accent:        k.primary     || '#ce4115',
            text:          k.ink         || '#13161c',
            heading:       k.inkStrong   || k.ink || '#05070c',
            textMuted:     k.muted       || '#66696e',
            grid:          k.borderLight || '#e2e5e8',
            border:        k.border      || '#ced1d6',
            surface:       k.surface     || '#fdfcfb',
            fontFamily:    k.fontFamily  || 'system-ui, sans-serif',
            fontSize:      12,
            fontSizeTitle: 13
        };
    }

    function create(host, canvas) {
        var ctx = canvas.getContext('2d');
        var view = { x: 0, y: 0, k: 1 };
        var userAdjusted = false;   // once true, a resize stops re-fitting
        var W = 0, H = 0, dpr = 1;

        /* ---- Transform ------------------------------------------------- */

        function toWorld(sx, sy) {
            return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
        }
        function screenX(n) { return n.x * view.k + view.x; }
        function screenY(n) { return n.y * view.k + view.y; }

        function zoomAt(sx, sy, factor) {
            var k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
            if (k === view.k) return false;
            view.x = sx - (sx - view.x) * (k / view.k);
            view.y = sy - (sy - view.y) * (k / view.k);
            view.k = k;
            userAdjusted = true;
            return true;
        }

        /** Pan by a screen-space delta. */
        function panBy(dx, dy) {
            view.x += dx;
            view.y += dy;
            userAdjusted = true;
        }

        /**
         * Absolute pinch update: scale about `from`, then follow the midpoint's
         * own travel to `to`, so one two-finger gesture pans and zooms together.
         */
        function pinch(k, from, to) {
            k = clamp(k, MIN_ZOOM, MAX_ZOOM);
            view.x = from.x - (from.x - view.x) * (k / view.k) + (to.x - from.x);
            view.y = from.y - (from.y - view.y) * (k / view.k) + (to.y - from.y);
            view.k = k;
            userAdjusted = true;
        }

        /** Fit every given node into the canvas, leaving room for the labels. */
        function fit(nodes) {
            if (!nodes.length || !W || !H) return;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            nodes.forEach(function (n) {
                var r = n.r + 6;
                if (n.x - r < minX) minX = n.x - r;
                if (n.y - r < minY) minY = n.y - r;
                if (n.x + r > maxX) maxX = n.x + r;
                if (n.y + r > maxY) maxY = n.y + r;
            });
            var pad = 26;
            view.k = clamp(Math.min((W - pad * 2 - 90) / Math.max(1, maxX - minX),
                (H - pad * 2) / Math.max(1, maxY - minY)), MIN_ZOOM, 1.6);
            view.x = (W - (minX + maxX) * view.k) / 2;
            view.y = (H - (minY + maxY) * view.k) / 2;
            userAdjusted = false;
        }

        /** Bring a node to the middle without changing the zoom level. */
        function centerOn(node) {
            view.x = W / 2 - node.x * view.k;
            view.y = H / 2 - node.y * view.k;
            userAdjusted = true;
        }

        /**
         * Match the backing store to the host box + pixel ratio. Returns false
         * when nothing changed, which is what stops a ResizeObserver loop: this
         * writes an inline px size onto the canvas, so any layout in which the
         * canvas can influence the host would otherwise ratchet — the bug that
         * made the AMIRA graph grow without bound in fullscreen. The CSS keeps
         * the canvas out of flow; this is the second line of defence, and it
         * also means a spurious observer callback costs nothing.
         */
        function resize() {
            var rect = host.getBoundingClientRect();
            if (!rect.width || !rect.height) return false;
            var ratio = Math.min(window.devicePixelRatio || 1, 2);
            var w = Math.round(rect.width);
            var h = Math.round(rect.height);
            if (w === W && h === H && ratio === dpr) return false;
            dpr = ratio;
            W = w;
            H = h;
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            canvas.style.width = W + 'px';
            canvas.style.height = H + 'px';
            return true;
        }

        /* ---- Hit testing ----------------------------------------------- */

        function nodeAt(nodes, px, py) {
            var best = null, bestD = Infinity;
            for (var i = nodes.length - 1; i >= 0; i--) {
                var n = nodes[i];
                var r = Math.max(6, n.r * view.k) + HIT_SLOP;
                var dx = screenX(n) - px, dy = screenY(n) - py;
                var d = dx * dx + dy * dy;
                if (d <= r * r && d < bestD) { best = n; bestD = d; }
            }
            return best;
        }

        function linkAt(links, px, py) {
            var best = null, bestD = LINK_HIT;
            for (var i = 0; i < links.length; i++) {
                var l = links[i];
                var d = distToSegment(px, py,
                    screenX(l.source), screenY(l.source), screenX(l.target), screenY(l.target));
                if (d < bestD) { bestD = d; best = l; }
            }
            return best;
        }

        /** Squared distance point→segment — the arc's chord is close enough here. */
        function distToSegment(px, py, x1, y1, x2, y2) {
            var dx = x2 - x1, dy = y2 - y1;
            var len = dx * dx + dy * dy;
            var t = clamp(len ? ((px - x1) * dx + (py - y1) * dy) / len : 0, 0, 1);
            var ex = x1 + t * dx - px, ey = y1 + t * dy - py;
            return ex * ex + ey * ey;
        }

        /* ---- Painting -------------------------------------------------- */

        function drawEdges(c, scene, o, T) {
            var fset = scene.focusSet;
            var k = view.k;
            c.lineCap = 'round';
            scene.links.forEach(function (l) {
                var inFocus = !fset || (fset[l.source.id] && fset[l.target.id]);
                var hovered = (l === scene.hoverLink);
                var alpha = inFocus ? l.alpha : l.alpha * 0.07;
                if (alpha < 0.012) return;
                var x1 = screenX(l.source), y1 = screenY(l.source);
                var x2 = screenX(l.target), y2 = screenY(l.target);
                // A slight arc separates the several statements that can join one
                // pair, and keeps a dense hub from collapsing into a single blob.
                var dx = x2 - x1, dy = y2 - y1;
                var cx = (x1 + x2) / 2 - dy * 0.075, cy = (y1 + y2) / 2 + dx * 0.075;
                c.globalAlpha = alpha;
                c.strokeStyle = (hovered || (fset && inFocus)) ? T.accent
                    : (l.weak ? T.grid : T.textMuted);
                c.lineWidth = (hovered ? l.width + 1.4 : (fset && inFocus ? l.width + 0.8 : l.width))
                    * clamp(k, 0.75, 1.6);
                if (l.weak) c.setLineDash([4 * k, 3 * k]); else c.setLineDash([]);
                c.beginPath();
                c.moveTo(x1, y1);
                c.quadraticCurveTo(cx, cy, x2, y2);
                c.stroke();
            });
            c.setLineDash([]);
            c.globalAlpha = 1;
        }

        function drawNodes(c, scene, o, T) {
            var fset = scene.focusSet;
            var k = view.k;
            scene.nodes.forEach(function (n) {
                var r = Math.max(1.6, n.r * k);
                var x = screenX(n), y = screenY(n);
                if (x < -r - 40 || y < -r - 40 || x > o.w + r + 40 || y > o.h + r + 40) return;
                var dim = fset && !fset[n.id];
                // Small nodes sit a touch back from the primary ones.
                var recessive = !n.isCenter && n.size <= 16;
                c.globalAlpha = dim ? 0.12 : (recessive ? 0.88 : 1);

                c.beginPath();
                c.arc(x, y, r, 0, Math.PI * 2);
                c.fillStyle = scene.colorOf(n.category);
                c.fill();

                var halo = (n.isCenter || !scene.showHalos) ? null : scene.haloOf(n);
                if (n.isCenter) {
                    c.strokeStyle = T.text;
                    c.lineWidth = Math.max(2, 3 * Math.min(k, 1.4));
                } else if (halo) {
                    c.strokeStyle = halo;
                    c.lineWidth = Math.max(1.5, 3 * Math.min(k, 1.2));
                } else {
                    c.strokeStyle = T.border;
                    c.lineWidth = 1;
                }
                c.stroke();

                // A pinned node keeps where the reader dragged it; the outer ring
                // is what says so without adding a second glyph to read.
                if (n.pinned) {
                    c.beginPath();
                    c.arc(x, y, r + 3.5, 0, Math.PI * 2);
                    c.strokeStyle = T.accent;
                    c.lineWidth = 1.25;
                    c.stroke();
                }
                // A selected node is the reader's anchor and stays marked while
                // they read its card, so it gets a solid ring — distinct from the
                // dashed keyboard-focus ring, which is transient.
                if (n.id === scene.selectedId) {
                    c.beginPath();
                    c.arc(x, y, r + 6, 0, Math.PI * 2);
                    c.strokeStyle = T.accent;
                    c.lineWidth = 2.5;
                    c.stroke();
                }
                if (n.id === scene.focusId) {
                    c.beginPath();
                    c.arc(x, y, r + (n.id === scene.selectedId ? 10 : 6), 0, Math.PI * 2);
                    c.strokeStyle = T.accent;
                    c.lineWidth = 2;
                    c.setLineDash([3, 2]);
                    c.stroke();
                    c.setLineDash([]);
                }
                c.globalAlpha = 1;
            });
        }

        function labelPriority(n, scene) {
            var p = n.deg || 0;
            if (n.isCenter) p += 10000;
            if (n.id === scene.hoverId || n.id === scene.focusId) p += 5000;
            if (scene.focusSet && scene.focusSet[n.id]) p += 2000;
            if (n.pinned) p += 1000;
            return p;
        }

        function overlaps(box, boxes) {
            for (var i = 0; i < boxes.length; i++) {
                var b = boxes[i];
                if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return true;
            }
            return false;
        }

        /**
         * Greedy collision placement: walk the nodes in priority order and keep
         * a label only while its box is still free. Zooming in frees space, so
         * more labels simply appear — there are no zoom thresholds to tune.
         *
         * This is the part the ECharts graph series could not do: it offered
         * `labelLayout: { hideOverlap: true }`, which hides by draw order rather
         * than by importance, so a 50-node ego graph kept the centre's label and
         * dropped almost everything else.
         */
        function drawLabels(c, scene, o, T) {
            var everything = o.allLabels || scene.labelsAll;
            var k = view.k;
            var boxes = [];
            var budget = everything ? scene.nodes.length : LABEL_BUDGET;
            var ordered = scene.nodes.slice().sort(function (a, b) {
                return labelPriority(b, scene) - labelPriority(a, scene);
            });
            c.textBaseline = 'middle';
            c.lineJoin = 'round';

            for (var i = 0; i < ordered.length && boxes.length < budget; i++) {
                var n = ordered[i];
                // Only these skip the collision test. Members of the focus set
                // get a priority boost (labelPriority) but are still
                // collision-tested: exempting them would let a hub with fifty
                // neighbours stack fifty labels on top of each other the moment
                // it is hovered.
                var forced = n.isCenter || n.pinned || n.id === scene.focusId
                    || n.id === scene.hoverId || n.id === scene.selectedId;
                if (!everything && !forced && n.deg <= 1 && k < 0.85) continue;
                if (scene.focusSet && !scene.focusSet[n.id] && !o.allLabels) continue;

                var size = n.isCenter ? T.fontSizeTitle : T.fontSize;
                c.font = (n.isCenter ? '700 ' : '') + size + 'px ' + T.fontFamily;
                var text = truncate(n.name, n.isCenter ? 48 : LABEL_MAX_LEN);
                var lx = screenX(n) + Math.max(1.6, n.r * k) + 5, ly = screenY(n);
                var box = [lx - 2, ly - size * 0.66, lx + c.measureText(text).width + 2, ly + size * 0.66];
                if (box[2] < 0 || box[0] > o.w || box[3] < 0 || box[1] > o.h) continue;
                if (!forced && overlaps(box, boxes)) continue;
                boxes.push(box);

                // Stroke the surface colour behind the glyphs so a label stays
                // legible where it crosses an edge.
                c.lineWidth = 3;
                c.strokeStyle = T.surface;
                c.strokeText(text, lx, ly);
                c.fillStyle = n.isCenter ? T.heading : T.text;
                c.fillText(text, lx, ly);
            }
            return boxes;   // handed to drawEdgeLabels so the two never collide
        }

        /**
         * Relationship names along their edges.
         *
         * Edge labels repeat hard (the same "12 shared items" phrasing forty
         * times), so drawing every one is noise: the reader gets them for the
         * node they selected or hovered — the case where "what IS this
         * connection?" is the actual question — and a toolbar toggle
         * (`scene.edgeLabels`) opts into the rest.
         *
         * Shares the caller's `boxes` list, so an edge label never lands on a
         * node label. Runs after them: naming the entities beats naming the wires.
         */
        function drawEdgeLabels(c, scene, o, boxes, T) {
            var focus = scene.selectedId || scene.hoverId;
            if (!scene.edgeLabels && !focus) return;
            var k = view.k;
            if (k < 0.45) return;                       // illegible; skip the work

            var candidates = scene.links.filter(function (l) {
                if (scene.edgeLabels) return true;
                return l.source.id === focus || l.target.id === focus;
            }).filter(function (l) { return l.name; });
            if (!candidates.length) return;

            // Edges touching the focused node first, then the shortest labels —
            // they fit in the gaps the long ones cannot.
            candidates.sort(function (a, b) {
                var af = (a.source.id === focus || a.target.id === focus) ? 1 : 0;
                var bf = (b.source.id === focus || b.target.id === focus) ? 1 : 0;
                return (bf - af) || (a.name.length - b.name.length);
            });

            var size = Math.max(9, T.fontSize - 2);
            c.font = size + 'px ' + T.fontFamily;
            c.textBaseline = 'middle';
            c.textAlign = 'center';
            c.lineJoin = 'round';

            var drawn = 0;
            var budget = scene.edgeLabels ? 60 : 24;
            for (var i = 0; i < candidates.length && drawn < budget; i++) {
                var l = candidates[i];
                var x1 = screenX(l.source), y1 = screenY(l.source);
                var x2 = screenX(l.target), y2 = screenY(l.target);
                // Midpoint of the same quadratic the edge was drawn with, so the
                // label sits ON its wire rather than beside the straight chord.
                var dx = x2 - x1, dy = y2 - y1;
                var cx = (x1 + x2) / 2 - dy * 0.075, cy = (y1 + y2) / 2 + dx * 0.075;
                var mx = (x1 + 2 * cx + x2) / 4, my = (y1 + 2 * cy + y2) / 4;
                if (mx < 0 || my < 0 || mx > o.w || my > o.h) continue;

                var text = truncate(l.name, 22);
                var half = c.measureText(text).width / 2 + 3;
                var box = [mx - half, my - size * 0.7, mx + half, my + size * 0.7];
                if (overlaps(box, boxes)) continue;
                boxes.push(box);
                drawn++;

                c.lineWidth = 3;
                c.strokeStyle = T.surface;
                c.strokeText(text, mx, my);
                c.fillStyle = T.textMuted;
                c.fillText(text, mx, my);
            }
            c.textAlign = 'left';
        }

        /** Category swatches along the bottom — drawn into the PNG export only. */
        function drawLegend(c, scene, o, T) {
            var used = {};
            scene.nodes.forEach(function (n) { used[n.category] = true; });
            var items = [];
            (scene.categories || []).forEach(function (cat, i) {
                if (used[i]) items.push({ name: cat.name, i: i });
            });
            if (!items.length) return;
            c.font = T.fontSize + 'px ' + T.fontFamily;
            c.textBaseline = 'middle';
            var x = 14, y = o.h - 14, gap = 16;
            items.forEach(function (it) {
                var w = c.measureText(it.name).width + 14 + gap;
                if (x + w > o.w - 14) { x = 14; y -= 18; }
                c.beginPath();
                c.arc(x + 4, y, 4.5, 0, Math.PI * 2);
                c.fillStyle = scene.colorOf(it.i);
                c.fill();
                c.fillStyle = T.textMuted;
                c.fillText(it.name, x + 14, y);
                x += w;
            });
        }

        /** One pass over the scene, shared by the live canvas and the export. */
        function render(c, scene, o) {
            var T = theme();
            c.save();
            c.scale(o.scale, o.scale);
            if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, o.w, o.h); }
            else c.clearRect(0, 0, o.w, o.h);
            drawEdges(c, scene, o, T);
            drawNodes(c, scene, o, T);
            drawEdgeLabels(c, scene, o, drawLabels(c, scene, o, T), T);
            if (o.legend) drawLegend(c, scene, o, T);
            c.restore();
        }

        function paint(scene) {
            if (!W || !H) return;
            render(ctx, scene, { w: W, h: H, scale: dpr, bg: null, allLabels: false, legend: false });
        }

        /** PNG at 2× on the surface colour, with every label that fits + legend. */
        function exportPng(scene) {
            var out = document.createElement('canvas');
            out.width = W * 2;
            out.height = H * 2;
            // The export ignores the transient hover/focus emphasis: a saved
            // image should show the whole graph, not whatever the pointer
            // happened to be on.
            var flat = Object.assign({}, scene, { focusSet: null, hoverLink: null, hoverId: null });
            render(out.getContext('2d'), flat, {
                w: W, h: H, scale: 2, bg: theme().surface, allLabels: true, legend: true
            });
            return out.toDataURL('image/png');
        }

        return {
            view: view,
            width: function () { return W; },
            height: function () { return H; },
            isUserAdjusted: function () { return userAdjusted; },
            resize: resize,
            fit: fit,
            centerOn: centerOn,
            zoomAt: zoomAt,
            panBy: panBy,
            pinch: pinch,
            toWorld: toWorld,
            screenX: screenX,
            screenY: screenY,
            nodeAt: nodeAt,
            linkAt: linkAt,
            paint: paint,
            exportPng: exportPng
        };
    }

    ns.GraphCanvas = {
        create: create,
        theme: theme,
        truncate: truncate,
        MIN_ZOOM: MIN_ZOOM,
        MAX_ZOOM: MAX_ZOOM
    };
})();
