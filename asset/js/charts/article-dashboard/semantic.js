/**
 * IWAC Visualizations — Article Dashboard: semantic neighbours
 *
 * Top K articles closest to the current one by cosine similarity of
 * the precomputed ``embedding_OCR`` (768-dim Gemini embedding). The
 * precompute already sorted them descending and dropped zero / invalid
 * similarities, so we just render what's handed to us.
 *
 * Visualization is a horizontal bar chart:
 *   - y-axis category = truncated article title
 *   - x-axis value    = similarity × 100 (i.e. a percentage)
 *   - bar color       = single IWAC palette[0] (primary)
 *   - tooltip         = full title + newspaper + date + similarity
 *   - click           = navigate to /item/<o_id>
 *
 * Why a bar chart rather than a table: similarity is a magnitude first
 * and a rank second. Seeing "87% — 85% — 73% — 41% …" as bars makes
 * the long-tail drop-off immediately legible in a way a numeric column
 * doesn't, and ECharts already handles click + tooltip cleanly.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.article-dashboard/semantic: missing panels or chartOptions');
        return;
    }

    var MAX_LABEL_LEN = 54;

    /**
     * Middle-ellipsis truncation so the end of long titles (which often
     * carries the most specific identifier — a name, date, location)
     * stays visible. Symmetry prevents the bar chart labels from all
     * looking like the same generic prefix.
     */
    function truncateMiddle(title, maxLen) {
        if (!title) return '';
        var s = String(title);
        if (s.length <= maxLen) return s;
        var keep = maxLen - 1;
        var left = Math.ceil(keep / 2);
        var right = Math.floor(keep / 2);
        return s.slice(0, left) + '\u2026' + s.slice(s.length - right);
    }

    /**
     * Escape for tooltip HTML. ECharts tooltips allow raw HTML and we
     * inject user-facing strings (titles, newspaper names) — must
     * escape.
     */
    function esc(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function render(panelEl, data, facet, ctx) {
        var neighbours = (data && data.semantic_neighbors) || [];

        if (neighbours.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No similar articles')));
            return;
        }

        // Build parallel arrays. We keep the raw records around too so
        // the click handler can look up the o_id by category name (the
        // chart's payload exposes the axis label, not the full record).
        var records = neighbours.slice();
        // Defensive: chart rendering expects top-down = most similar
        // first, and the `yAxis.inverse: true` that horizontalBar sets
        // already flips the natural data order. So we DON'T need to
        // reverse — matches how person/entity horizontal-bar panels
        // behave.
        var entries = records.map(function (n) {
            return {
                name:  truncateMiddle(n.title || ('#' + n.o_id), MAX_LABEL_LEN),
                count: Math.round((n.similarity || 0) * 1000) / 10, // one decimal %
                // Custom keys carried through via ECharts' data object
                // for the tooltip / click handler.
                _full:      n.title || '',
                _newspaper: n.newspaper || '',
                _date:      n.date || '',
                _similarity: n.similarity || 0,
                _o_id:      n.o_id
            };
        });

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var option = C.horizontalBar(entries, { nameKey: 'name', valueKey: 'count' });

            // Replace the default value-axis tooltip with a custom
            // item-triggered one that shows the full title + newspaper
            // + date + similarity. The axis-trigger default loses
            // category-row context when bars are sparse.
            option.tooltip = {
                trigger: 'item',
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    // ECharts passes only `value` + `name` by default;
                    // we re-look-up the record by category name because
                    // the data array is plain numbers at this point.
                    // Index into our `entries` via dataIndex.
                    var rec = entries[p.dataIndex] || {};
                    var lines = ['<strong>' + esc(rec._full || p.name) + '</strong>'];
                    if (rec._newspaper) lines.push(esc(rec._newspaper));
                    if (rec._date)      lines.push(P.formatDate(rec._date));
                    lines.push(P.t('Similarity') + ': ' + (rec.count || 0).toFixed(1) + '%');
                    return lines.join('<br>');
                }
            };

            // Format the on-bar label as "NN%" instead of raw digits.
            if (option.series && option.series[0] && option.series[0].label) {
                option.series[0].label.formatter = function (p) {
                    return (p.value || 0).toFixed(1) + '%';
                };
            }

            // Rails the x axis to 0..100 so the bars are comparable
            // across articles — a top semantic neighbour at 47% should
            // visibly fall well short of one at 92%.
            option.xAxis = option.xAxis || { type: 'value' };
            option.xAxis.min = 0;
            option.xAxis.max = 100;
            option.xAxis.axisLabel = option.xAxis.axisLabel || {};
            option.xAxis.axisLabel.formatter = function (v) { return v + '%'; };

            instance.setOption(option, true);
        });

        if (!chart) return;

        chart.on('click', function (params) {
            var rec = entries[params.dataIndex];
            if (rec && rec._o_id != null && ctx && ctx.siteBase) {
                window.location.href = ctx.siteBase + '/item/' + rec._o_id;
            }
        });

        // Cursor hint on hover so users know bars are clickable.
        // chart.getZr() is the underlying zrender surface.
        var zr = chart.getZr && chart.getZr();
        if (zr) {
            zr.on('mousemove', function (e) {
                // Best-effort — zrender's target info is shape-dependent.
                // `chart.containPixel` lets us ask ECharts if the point
                // is over a grid cell with data.
                var isBar = chart.containPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]);
                panelEl.chart.style.cursor = isBar ? 'pointer' : '';
            });
            zr.on('mouseleave', function () {
                panelEl.chart.style.cursor = '';
            });
        }
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.semantic = { render: render };
})();
