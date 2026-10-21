/**
 * IWAC Visualizations — Sibling sparkline renderer
 *
 * Inline-SVG sparkline (~60 px tall) showing where the current item
 * sits in a sibling timeline — e.g. "this article in its newspaper's
 * publication arc". Pure SVG; ECharts is overkill for a 60 px strip
 * and bloats the bundle on per-article pages where many sparklines
 * may render at once.
 *
 * Theme tracking is automatic via CSS custom properties: stroke /
 * fill use `var(--ink-light)` etc., so light/dark toggle flips colours
 * without JS re-render and without registering with `IWACVis._charts`.
 *
 * Data shape:
 *
 *     {
 *       years:     [2010, 2011, 2012, ..., 2024],
 *       values:    [3, 7, 5, 12, 8, ...],
 *       highlight: 2018,                             // optional, draws a dot
 *       caption:   '12 articles in this newspaper'   // optional, small text below
 *     }
 *
 * Registered as `siblingSparkline`. Predicate: ≥ 2 years with values.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.sibling-sparkline: dashboard-layout.js + panels.js must load first');
        return;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';

    // Year labels are `--text-2xs` (11px) and sit on the bottom edge. In user
    // units, which is what both the geometry and the type scale in, so these
    // hold at any rendered width:
    //   LABEL_BAND  the strip the labels own — 11px type plus 2px clearance.
    //               The plot used to run to the bottom edge, so a series near
    //               zero at either end drew its line through "1992".
    //   LABEL_W     a four-digit year at 11px in the body face (~26 units).
    //   LABEL_GAP   the least daylight kept between two labels.
    var LABEL_BAND = 13;
    var LABEL_W    = 28;
    var LABEL_GAP  = 4;

    function svg(tag, attrs) {
        var n = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            for (var k in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, k)) {
                    n.setAttribute(k, attrs[k]);
                }
            }
        }
        return n;
    }

    function buildSparkline(data) {
        var years  = (data && data.years)  || [];
        var values = (data && data.values) || [];
        if (years.length < 2 || values.length !== years.length) return null;

        var W = 320;
        var H = 56;
        var pad = 4;
        var base = H - LABEL_BAND;   // the plot's floor; the labels live below it
        var innerW = W - pad * 2;
        var innerH = base - pad;

        var max = 1;
        for (var i = 0; i < values.length; i++) {
            if (values[i] > max) max = values[i];
        }

        var stepX = innerW / (years.length - 1);
        var pts = values.map(function (v, idx) {
            var x = pad + idx * stepX;
            var y = base - (v / max) * innerH;
            return [x, y];
        });

        var root = svg('svg', {
            'viewBox': '0 0 ' + W + ' ' + H,
            'class': 'iwac-vis-sparkline',
            'role': 'img',
            'aria-label': data.caption || ''
        });

        // Filled area under the curve — soft tinted region
        var areaD = 'M' + pts[0][0] + ',' + base + ' L' +
            pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
            ' L' + pts[pts.length - 1][0] + ',' + base + ' Z';
        root.appendChild(svg('path', {
            'd': areaD,
            'class': 'iwac-vis-sparkline__area'
        }));

        // Line
        var lineD = 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
        root.appendChild(svg('path', {
            'd': lineD,
            'class': 'iwac-vis-sparkline__line'
        }));

        // Highlight dot (current year). Its label centres under the dot, but
        // is pinned to the edge when centring would clip it off-canvas.
        // That used to be decided by index — only the first and last year
        // were pinned — so a highlight one step in still clipped, and one a
        // few steps in still overprinted the endpoint label beside it (the
        // garbled "207014" on first-year issues; "20172019" two years from
        // the end). Deciding from where the label actually lands covers both.
        var hlIdx = data.highlight != null ? years.indexOf(data.highlight) : -1;
        var hlLeft = Infinity;
        var hlRight = -Infinity;
        if (hlIdx >= 0) {
            var p = pts[hlIdx];
            root.appendChild(svg('circle', {
                'cx': p[0],
                'cy': p[1],
                'r': 3.5,
                'class': 'iwac-vis-sparkline__dot'
            }));
            var hlAnchor = 'middle';
            var hlX = p[0];
            hlLeft = p[0] - LABEL_W / 2;
            if (hlLeft < pad) {
                hlAnchor = 'start';
                hlX = pad;
                hlLeft = pad;
            } else if (hlLeft + LABEL_W > W - pad) {
                hlAnchor = 'end';
                hlX = W - pad;
                hlLeft = W - pad - LABEL_W;
            }
            hlRight = hlLeft + LABEL_W;
            var label = svg('text', {
                'x': hlX,
                'y': H - 1,
                'class': 'iwac-vis-sparkline__year',
                'text-anchor': hlAnchor
            });
            label.textContent = String(data.highlight);
            root.appendChild(label);
        }

        // Endpoint year labels — dropped where the highlight label would
        // overprint them. The highlight is the page's own year, so it wins.
        if (hlLeft >= pad + LABEL_W + LABEL_GAP) {
            var startLabel = svg('text', {
                'x': pad,
                'y': H - 1,
                'class': 'iwac-vis-sparkline__year iwac-vis-sparkline__year--end'
            });
            startLabel.textContent = String(years[0]);
            root.appendChild(startLabel);
        }

        if (hlRight <= W - pad - LABEL_W - LABEL_GAP) {
            var endLabel = svg('text', {
                'x': W - pad,
                'y': H - 1,
                'class': 'iwac-vis-sparkline__year iwac-vis-sparkline__year--end',
                'text-anchor': 'end'
            });
            endLabel.textContent = String(years[years.length - 1]);
            root.appendChild(endLabel);
        }

        return root;
    }

    DL.registerRenderer('siblingSparkline', function (el, data) {
        // Per-card panel-toolbar download is meaningless for a 60 px
        // sparkline — opt the parent panel out of auto-attaching it.
        var panel = el.closest && el.closest('.iwac-vis-panel');
        if (panel) panel.setAttribute('data-iwac-no-panel-toolbar', '1');

        var sparkline = buildSparkline(data);
        if (!sparkline) {
            el.appendChild(P.buildEmptyState());
            return;
        }
        // `--auto` drops the 320px ECharts floor so the ~60px sparkline
        // doesn't sit atop a tall empty panel.
        el.classList.add('iwac-vis-sparkline-host', 'iwac-vis-chart--auto');
        el.appendChild(sparkline);
        if (data.caption) {
            var cap = P.el('p', 'iwac-vis-sparkline__caption', data.caption);
            el.appendChild(cap);
        }
    });

    DL.registerMetadata('siblingSparkline', {
        labelKey: 'Activity sparkline',
        descKey:  'desc_sibling_sparkline',
        hasData:  function (v) {
            return v && Array.isArray(v.years) && Array.isArray(v.values)
                && v.years.length >= 2
                && v.years.length === v.values.length;
        }
    });
})();
