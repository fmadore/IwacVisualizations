/**
 * IWAC Visualizations — Chart data as rows
 *
 * Part of the `IWACVis.panels` namespace (loads after panels.js, before
 * panel-toolbar.js). Turns the option a chart was painted with back into
 * the table it came from, so a panel can offer "View as table" and
 * "Download CSV" without each block re-deriving its own data.
 *
 * Until v1.61.0 a chart's data reached a reader in exactly two forms: the
 * pixels, and the one-sentence aria description that replaces ECharts'
 * own recitation. The pixels are what a sighted reader sees and the
 * sentence is, by design, all a screen reader gets — so nothing on the
 * site let anyone read the numbers, sort them, or take them into a
 * spreadsheet. The option ECharts is handed carries those numbers in a
 * handful of shapes, all of them enumerated here.
 *
 * Shapes read (in this order):
 *
 *   - a category axis + N series  → one row per category, one column per
 *     series (bar, line, stacked timelines; items numeric, `{name, value}`
 *     or `[x, y]`; series shorter than the axis are keyed by item name)
 *   - a heatmap over two category axes → a matrix, rows by the y axis
 *   - name/value series (pie, funnel, wordcloud, treemap, sunburst) → one
 *     row per item, nested trees flattened with a ` › ` path
 *   - two value axes (scatter) → one row per point: series, x, y
 *
 * Series types that carry no tabular reading (graph, custom, lines, map,
 * sankey, tree) return null and the toolbar offers nothing. A panel whose
 * chart draws something the option does not describe opts out with
 * `data-iwac-no-table="1"`.
 *
 * Cells are numbers, strings, null, or `{ text, href }` for a link — the
 * map panels hand their place lists through the same shape
 * (`P.setPanelRows`), which is also the only non-pointer route to a map's
 * data.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    var NO_TABLE = { graph: 1, custom: 1, lines: 1, map: 1, sankey: 1, tree: 1,
        pictorialBar: 1, themeRiver: 1, gauge: 1 };
    var NAME_VALUE = { pie: 1, funnel: 1, wordCloud: 1, treemap: 1, sunburst: 1 };

    function t(key, params) {
        return typeof P.t === 'function' ? P.t(key, params) : key;
    }

    function toArray(value) {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    }

    function isNum(v) {
        return typeof v === 'number' && isFinite(v);
    }

    /** A category axis with a data array, if the option has one on `key`. */
    function categoryAxis(base, key) {
        var axes = toArray(base[key]);
        for (var i = 0; i < axes.length; i++) {
            var a = axes[i];
            if (a && a.type === 'category' && Array.isArray(a.data)) return a;
        }
        return null;
    }

    function axisLabel(axis, fallbackKey) {
        var name = axis && axis.name ? String(axis.name).trim() : '';
        return name || t(fallbackKey);
    }

    function categoryLabel(entry) {
        if (entry == null) return '';
        if (typeof entry === 'object') return entry.value != null ? String(entry.value) : '';
        return String(entry);
    }

    function seriesName(s, index) {
        return s && s.name != null && s.name !== '' ? String(s.name) : t('Series') + ' ' + (index + 1);
    }

    /**
     * The number in a data item, for a category chart. `along` is the index
     * of the value inside an array item: 1 when the category runs along x
     * (`[x, y]` pairs put the value second), 0 when it runs along y.
     */
    function itemValue(item, along) {
        if (item == null) return null;
        if (isNum(item)) return item;
        if (typeof item === 'string') {
            var n = Number(item);
            return isNaN(n) ? item : n;
        }
        if (Array.isArray(item)) return itemValue(item[along], along);
        if (typeof item === 'object') {
            if (item.value === undefined) return null;
            if (Array.isArray(item.value)) return itemValue(item.value[along], along);
            return itemValue(item.value, along);
        }
        return null;
    }

    /** The category an item names, when it names one (`{name}` or `[cat, v]`). */
    function itemCategory(item, along) {
        if (item == null || isNum(item) || typeof item === 'string') return null;
        if (Array.isArray(item)) {
            var head = item[along === 1 ? 0 : 1];
            return typeof head === 'string' ? head : null;
        }
        if (typeof item === 'object') {
            if (item.name != null) return String(item.name);
            if (Array.isArray(item.value)) return itemCategory(item.value, along);
        }
        return null;
    }

    function categoryRows(base, series, axis, along) {
        var categories = axis.data.map(categoryLabel);
        var columns = [{ label: axisLabel(axis, 'Category'), numeric: false }];
        var grid = categories.map(function (c) { return [c]; });
        series.forEach(function (s, si) {
            columns.push({ label: seriesName(s, si), numeric: true });
            var byName = null;
            // Items that name their category (the named bar items of the
            // horizontal builders, `[cat, v]` pairs) are placed by name;
            // anything else by position.
            if (s.data.length !== categories.length || s.data.some(function (d) {
                return itemCategory(d, along) != null;
            })) {
                byName = {};
                s.data.forEach(function (d, di) {
                    var cat = itemCategory(d, along);
                    if (cat == null) cat = categories[di];
                    if (cat != null && !(cat in byName)) byName[cat] = itemValue(d, along);
                });
            }
            categories.forEach(function (c, ci) {
                var v = byName ? (c in byName ? byName[c] : null) : itemValue(s.data[ci], along);
                grid[ci].push(v);
                if (v != null && !isNum(v)) columns[columns.length - 1].numeric = false;
            });
        });
        return { columns: columns, rows: grid };
    }

    function heatmapRows(base, series, xAxis, yAxis) {
        var xs = xAxis.data.map(categoryLabel);
        var ys = yAxis.data.map(categoryLabel);
        var columns = [{ label: axisLabel(yAxis, 'Category'), numeric: false }]
            .concat(xs.map(function (x) { return { label: x, numeric: true }; }));
        var grid = ys.map(function (y) {
            var row = [y];
            for (var i = 0; i < xs.length; i++) row.push(null);
            return row;
        });
        series.forEach(function (s) {
            s.data.forEach(function (d) {
                var cell = d && !Array.isArray(d) && typeof d === 'object' ? d.value : d;
                if (!Array.isArray(cell) || cell.length < 3) return;
                var xi = isNum(cell[0]) ? cell[0] : xs.indexOf(String(cell[0]));
                var yi = isNum(cell[1]) ? cell[1] : ys.indexOf(String(cell[1]));
                if (xi < 0 || yi < 0 || !grid[yi]) return;
                grid[yi][xi + 1] = isNum(cell[2]) ? cell[2] : (cell[2] == null ? null : cell[2]);
            });
        });
        return { columns: columns, rows: grid };
    }

    function flattenNamed(items, path, out) {
        (items || []).forEach(function (d) {
            if (d == null) return;
            var name = typeof d === 'object' && !Array.isArray(d) ? d.name : null;
            var label = name != null ? String(name) : '';
            var full = path ? path + ' › ' + label : label;
            var children = typeof d === 'object' && Array.isArray(d.children) ? d.children : null;
            if (children && children.length) {
                flattenNamed(children, full, out);
                return;
            }
            var v = typeof d === 'object' && !Array.isArray(d) ? d.value : d;
            if (Array.isArray(v)) v = v[0];
            out.push([full, isNum(v) ? v : (v == null ? null : v)]);
        });
    }

    function namedRows(series) {
        var columns = [{ label: t('Name'), numeric: false }];
        if (series.length === 1) {
            var out = [];
            flattenNamed(series[0].data, '', out);
            columns.push({ label: seriesName(series[0], 0) === t('Series') + ' 1'
                ? t('Value') : seriesName(series[0], 0), numeric: true });
            return { columns: columns, rows: out };
        }
        // Several name/value series: one column each, keyed by name.
        var names = [];
        var byName = {};
        series.forEach(function (s, si) {
            columns.push({ label: seriesName(s, si), numeric: true });
            var flat = [];
            flattenNamed(s.data, '', flat);
            flat.forEach(function (pair) {
                if (!(pair[0] in byName)) { byName[pair[0]] = {}; names.push(pair[0]); }
                byName[pair[0]][si] = pair[1];
            });
        });
        return {
            columns: columns,
            rows: names.map(function (n) {
                var row = [n];
                series.forEach(function (s, si) { row.push(si in byName[n] ? byName[n][si] : null); });
                return row;
            })
        };
    }

    function pointRows(base, series) {
        var xs = toArray(base.xAxis)[0];
        var ys = toArray(base.yAxis)[0];
        var columns = [
            { label: t('Series'), numeric: false },
            { label: axisLabel(xs, 'x'), numeric: true },
            { label: axisLabel(ys, 'y'), numeric: true }
        ];
        var rows = [];
        series.forEach(function (s, si) {
            var name = seriesName(s, si);
            s.data.forEach(function (d) {
                var v = d && !Array.isArray(d) && typeof d === 'object' ? d.value : d;
                if (!Array.isArray(v) || v.length < 2) return;
                rows.push([name, isNum(v[0]) ? v[0] : String(v[0]), isNum(v[1]) ? v[1] : String(v[1])]);
            });
        });
        return rows.length ? { columns: columns, rows: rows } : null;
    }

    /**
     * Series that carry data and a readable type. Empty when any series is
     * of a kind the table cannot represent — a half-table would claim to
     * be the chart.
     */
    function readableSeries(base) {
        var all = toArray(base && base.series).filter(function (s) { return s && Array.isArray(s.data); });
        if (!all.length) return [];
        for (var i = 0; i < all.length; i++) {
            if (NO_TABLE[all[i].type || 'line']) return [];
        }
        return all;
    }

    /**
     * Cheap "would optionToRows return anything?" — for the toolbar to
     * decide whether the table buttons apply, without building the rows on
     * every repaint.
     */
    P.hasTabularOption = function (option) {
        var base = option && (option.baseOption || option);
        if (!base) return false;
        var series = readableSeries(base);
        return series.some(function (s) { return s.data.length > 0; });
    };

    /**
     * @param {Object} option  the option a chart was painted with (or its
     *   `{ baseOption, media }` form)
     * @returns {{columns: Array<{label: string, numeric: boolean}>,
     *            rows: Array<Array>}|null}
     */
    P.optionToRows = function (option) {
        var base = option && (option.baseOption || option);
        if (!base) return null;
        var series = readableSeries(base);
        if (!series.length) return null;

        var xCat = categoryAxis(base, 'xAxis');
        var yCat = categoryAxis(base, 'yAxis');
        var heat = series.every(function (s) { return s.type === 'heatmap'; });

        if (heat && xCat && yCat) return heatmapRows(base, series, xCat, yCat);
        if (series.every(function (s) { return NAME_VALUE[s.type]; })) return namedRows(series);
        if (xCat) return categoryRows(base, series, xCat, 1);
        if (yCat) return categoryRows(base, series, yCat, 0);
        if (base.xAxis || base.yAxis) return pointRows(base, series);
        if (series.every(function (s) { return s.data.every(function (d) {
            return d && typeof d === 'object' && !Array.isArray(d) && d.name != null;
        }); })) return namedRows(series);
        return null;
    };

    /* ----------------------------------------------------------------- */
    /*  CSV                                                               */
    /* ----------------------------------------------------------------- */

    function cellText(cell) {
        if (cell == null) return '';
        if (typeof cell === 'object' && !Array.isArray(cell)) {
            return cell.text != null ? String(cell.text) : '';
        }
        return String(cell);
    }

    function csvField(value) {
        var s = cellText(value);
        // Formula injection: a cell starting with = + - @ is executed by
        // spreadsheet software. A leading apostrophe makes it text.
        if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = '\'' + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /**
     * RFC 4180 CSV — comma, CRLF, quotes doubled — with a UTF-8 BOM so a
     * spreadsheet opens the accented names correctly, and numbers written
     * raw (a dot decimal, no thousands separator) so they stay numbers.
     *
     * @param {{columns: Array<{label: string}>, rows: Array<Array>}} table
     * @returns {string}
     */
    P.rowsToCsv = function (table) {
        if (!table) return '';
        var lines = [table.columns.map(function (c) { return csvField(c.label); }).join(',')];
        (table.rows || []).forEach(function (row) {
            lines.push(row.map(csvField).join(','));
        });
        return '\uFEFF' + lines.join('\r\n') + '\r\n';
    };

    /** The text of a cell, for callers that render rows themselves. */
    P.cellText = cellText;
})();
