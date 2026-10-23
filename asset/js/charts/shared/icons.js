/**
 * IWAC Visualizations — Control icons
 *
 * One drawn vocabulary for every icon button in the module: the panel
 * toolbar, both graph toolbars, the embed button, the copy-link button and
 * the playback controls. They used to be Unicode characters (⭳ ▤ ⛶ ↺ ❄ …),
 * which each font draws at its own size, weight and baseline — or not at
 * all — so the buttons in one toolbar never matched one another, and
 * "CSV" and "</>" sat beside them as words.
 *
 * The paths are Lucide's (ISC licence, lucide.dev), the set the IWAC theme
 * already draws its own chrome with: a 24px grid, 2px round strokes, ink
 * from `currentColor`, so hover, pressed and dark mode recolour them with
 * no rule of their own. Rects and circles are written as paths so every
 * entry is a list of `d` strings.
 *
 * Load order: after panels.js (it hangs off `IWACVis.panels`), before any
 * file that builds a button with `P.iconButton` or `P.icon`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    var SVG_NS = 'http://www.w3.org/2000/svg';

    var ICONS = {
        // Download chart: an image with an arrow — distinct from the CSV file.
        'image-down': [
            'M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21',
            'm14 19 3 3v-5.5',
            'm17 22 3-3',
            'M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0'
        ],
        table: [
            'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
            'M3 9h18',
            'M3 15h18',
            'M9 9v12',
            'M15 9v12'
        ],
        'file-spreadsheet': [
            'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
            'M14 2v5a1 1 0 0 0 1 1h5',
            'M8 13h2',
            'M14 13h2',
            'M8 17h2',
            'M14 17h2'
        ],
        code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
        check: ['M20 6 9 17l-5-5'],
        link: [
            'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
            'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
        ],
        maximize: [
            'M8 3H5a2 2 0 0 0-2 2v3',
            'M21 8V5a2 2 0 0 0-2-2h-3',
            'M3 16v3a2 2 0 0 0 2 2h3',
            'M16 21h3a2 2 0 0 0 2-2v-3'
        ],
        minimize: [
            'M8 3v3a2 2 0 0 1-2 2H3',
            'M21 8h-3a2 2 0 0 1-2-2V3',
            'M3 16h3a2 2 0 0 1 2 2v3',
            'M16 21v-3a2 2 0 0 1 2-2h3'
        ],
        plus: ['M5 12h14', 'M12 5v14'],
        minus: ['M5 12h14'],
        'rotate-ccw': ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
        type: ['M12 4v16', 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2', 'M9 20h6'],
        'move-horizontal': ['m18 8 4 4-4 4', 'M2 12h20', 'm6 8-4 4 4 4'],
        snowflake: [
            'm10 20-1.25-2.5L6 18', 'M10 4 8.75 6.5 6 6', 'm14 20 1.25-2.5L18 18',
            'm14 4 1.25 2.5L18 6', 'm17 21-3-6h-4', 'm17 3-3 6 1.5 3', 'M2 12h6.5L10 9',
            'm20 10-1.5 2 1.5 2', 'M22 12h-6.5L14 15', 'm4 10 1.5 2L4 14',
            'm7 21 3-6-1.5-3', 'm7 3 3 6h4'
        ],
        'pin-off': [
            'M12 17v5',
            'M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89',
            'm2 2 20 20',
            'M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11'
        ],
        play: ['M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'],
        pause: [
            'M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
            'M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'
        ],
        'chevron-left': ['m15 18-6-6 6-6'],
        'chevron-right': ['m9 18 6-6-6-6'],
        'chevron-down': ['m6 9 6 6 6-6'],
        'map-pin': [
            'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
            'M9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0'
        ],
        x: ['M18 6 6 18', 'm6 6 12 12'],
        'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
        // The marker for AI-generated content.
        sparkles: [
            'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
            'M20 2v4',
            'M22 4h-4',
            'M2 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0'
        ],
        // The map's choropleth toggle: fill the regions.
        'paint-bucket': [
            'M11 7 6 2',
            'M18.992 12H2.041',
            'M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595',
            'm8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33'
        ]
    };

    /*  Solid where an outline would read as "disabled": the media shapes. */
    var FILLED = { play: true, pause: true };

    P.ICONS = ICONS;

    /**
     * An inline SVG icon, decorative: the button carrying it holds the
     * accessible name. Sized and stroked by `.iwac-vis-icon` in iwac-core.css.
     *
     * @param {string} name  a key of `P.ICONS`
     * @returns {SVGSVGElement|null}  null for an unknown name
     */
    P.icon = function (name) {
        var paths = ICONS[name];
        if (!paths) return null;
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'iwac-vis-icon' + (FILLED[name] ? ' iwac-vis-icon--filled' : ''));
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        paths.forEach(function (d) {
            var p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            svg.appendChild(p);
        });
        return svg;
    };

    /**
     * Replace `el`'s face with icon `name`, then `text` when given (a
     * labelled button). The accessible name is left alone: a label that
     * changes with state is the caller's to set.
     *
     * @param {Element} el
     * @param {string} name
     * @param {string} [text]
     * @returns {Element} el
     */
    P.setIcon = function (el, name, text) {
        el.textContent = '';
        var svg = P.icon(name);
        if (svg) el.appendChild(svg);
        if (text) el.appendChild(P.el('span', null, text));
        return el;
    };
})();
