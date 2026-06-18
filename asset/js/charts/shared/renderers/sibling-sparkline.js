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
        var innerW = W - pad * 2;
        var innerH = H - pad * 2;

        var max = 1;
        for (var i = 0; i < values.length; i++) {
            if (values[i] > max) max = values[i];
        }

        var stepX = innerW / (years.length - 1);
        var pts = values.map(function (v, idx) {
            var x = pad + idx * stepX;
            var y = pad + innerH - (v / max) * innerH;
            return [x, y];
        });

        var root = svg('svg', {
            'viewBox': '0 0 ' + W + ' ' + H,
            'class': 'iwac-vis-sparkline',
            'role': 'img',
            'aria-label': data.caption || ''
        });

        // Filled area under the curve — soft tinted region
        var areaD = 'M' + pts[0][0] + ',' + (H - pad) + ' L' +
            pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
            ' L' + pts[pts.length - 1][0] + ',' + (H - pad) + ' Z';
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

        // Highlight dot (current year). When the highlight sits on an
        // endpoint, anchor its label to that edge — otherwise the
        // centre-anchored label both clips off-canvas and overprints the
        // endpoint label below it (the garbled "207014" on first-year
        // issues).
        var lastIdx = years.length - 1;
        var hlIdx = data.highlight != null ? years.indexOf(data.highlight) : -1;
        if (hlIdx >= 0) {
            var p = pts[hlIdx];
            root.appendChild(svg('circle', {
                'cx': p[0],
                'cy': p[1],
                'r': 3.5,
                'class': 'iwac-vis-sparkline__dot'
            }));
            var hlAnchor = hlIdx === 0 ? 'start' : (hlIdx === lastIdx ? 'end' : 'middle');
            var hlX      = hlIdx === 0 ? pad   : (hlIdx === lastIdx ? (W - pad) : p[0]);
            var label = svg('text', {
                'x': hlX,
                'y': H - 1,
                'class': 'iwac-vis-sparkline__year',
                'text-anchor': hlAnchor
            });
            label.textContent = String(data.highlight);
            root.appendChild(label);
        }

        // Endpoint year labels — skip whichever end the highlight label
        // already covers so the two never overprint.
        if (hlIdx !== 0) {
            var startLabel = svg('text', {
                'x': pad,
                'y': H - 1,
                'class': 'iwac-vis-sparkline__year iwac-vis-sparkline__year--end'
            });
            startLabel.textContent = String(years[0]);
            root.appendChild(startLabel);
        }

        if (hlIdx !== lastIdx) {
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
