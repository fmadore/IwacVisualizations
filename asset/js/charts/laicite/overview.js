/**
 * IWAC Visualizations — Laïcité block: Overview view (issue #14, view 1).
 *
 * The dossier header: the tag-vs-text Venn, the per-corpus table, the rights
 * note, and the frame legend.
 *
 * Two rules are enforced visually rather than only in the data:
 *   - No number sums across corpora without saying so. The table has one row
 *     per corpus and no total row, because a 300-page monograph and a
 *     400-word news item are not commensurable units.
 *   - The readable/withheld split is shown per corpus, never as one overall
 *     percentage, because it ranges from 25/26 to 7/867.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite overview: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /**
     * The tag-vs-text Venn, as three proportional bands rather than circles:
     * a real Venn with these ratios is unreadable, and the bands are also
     * clickable targets and screen-reader text, which circles are not.
     *
     * @param {Object} metadata
     * @param {function(string):void} onSelect  called with 'tagged_only' |
     *        'both' | 'said_only'
     */
    L.buildVenn = function (metadata, onSelect) {
        var totals = metadata.totals || {};
        var subsets = metadata.subsets || {};
        var tagOnly = 0, both = 0, saidOnly = 0;
        L.SUBSETS.forEach(function (s) {
            var v = subsets[s] || {};
            tagOnly += v.tagged_only || 0;
            both += v.tagged_and_said || 0;
            saidOnly += v.said_only || 0;
        });
        var total = tagOnly + both + saidOnly || 1;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-venn');
        panel.appendChild(P.el('h4', null, P.t('laicite.venn_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc', P.t('laicite.venn_hint')));

        var bar = P.el('div', 'iwac-vis-laicite-venn-bar');
        bar.setAttribute('role', 'group');
        var cells = [
            { key: 'tagged_only', n: tagOnly, labelKey: 'laicite.venn_tagged_only', cls: 'is-tagged' },
            { key: 'both', n: both, labelKey: 'laicite.venn_both', cls: 'is-both' },
            { key: 'said_only', n: saidOnly, labelKey: 'laicite.venn_said_only', cls: 'is-said' }
        ];
        cells.forEach(function (cell) {
            var seg = P.el('button', 'iwac-vis-laicite-venn-seg ' + cell.cls);
            seg.type = 'button';
            seg.style.flexGrow = String(Math.max(cell.n, total * 0.06));
            seg.appendChild(P.el('span', 'iwac-vis-laicite-venn-n',
                P.formatNumber(cell.n)));
            seg.appendChild(P.el('span', 'iwac-vis-laicite-venn-label',
                P.t(cell.labelKey)));
            seg.setAttribute('aria-label',
                P.t(cell.labelKey) + ': ' + P.formatNumber(cell.n));
            if (onSelect) {
                seg.addEventListener('click', function () { onSelect(cell.key); });
            } else {
                seg.disabled = true;
            }
            bar.appendChild(seg);
        });
        panel.appendChild(bar);
        void totals;
        return panel;
    };

    /**
     * One row per corpus. No total row — see the module docblock.
     */
    L.buildSubsetTable = function (metadata) {
        var subsets = metadata.subsets || {};
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-subsets');
        panel.appendChild(P.el('h4', null, P.t('laicite.subset_table_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc', P.t('laicite.no_sum_note')));

        // Seven columns of counts, built by hand rather than through
        // P.buildTable because of the corpus row-header and the readable
        // meter. It still wears the shared table's element classes, its
        // ARIA roles and its card roles, so below `sm` it collapses into
        // the same labelled records every other table in the module does.
        var COLS = ['laicite.col_corpus', 'laicite.col_members', 'laicite.col_tagged',
            'laicite.col_said', 'laicite.col_occurrences', 'laicite.col_readable',
            'laicite.col_span'];

        var table = P.el('table', 'iwac-vis-table iwac-vis-laicite-table');
        table.setAttribute('role', 'table');
        var thead = P.el('thead');
        thead.setAttribute('role', 'rowgroup');
        var hrow = P.el('tr');
        hrow.setAttribute('role', 'row');
        COLS.forEach(function (key) {
            var th = P.el('th', 'iwac-vis-table__header', P.t(key));
            th.setAttribute('role', 'columnheader');
            th.setAttribute('scope', 'col');
            hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        /** One body cell, wearing the shared classes and its card role. */
        function cell(className, role, colKey) {
            var td = P.el('td', 'iwac-vis-table__cell' +
                (className ? ' ' + className : ''));
            td.setAttribute('role', 'cell');
            P.tableCardCell(td, role, colKey ? P.t(colKey) : '');
            return td;
        }

        var tbody = P.el('tbody');
        tbody.setAttribute('role', 'rowgroup');
        L.SUBSETS.forEach(function (subset) {
            var v = subsets[subset];
            if (!v) return;
            var tr = P.el('tr', 'iwac-vis-table__row');
            tr.setAttribute('role', 'row');
            // Name plus a one-line gloss. Four bare corpus labels invite the
            // reading that only one of them holds primary sources; the gloss
            // says what each actually contains, and the note under the table
            // says which one is not a source at all.
            var corpus = P.el('th', 'iwac-vis-table__cell iwac-vis-laicite-corpus');
            corpus.setAttribute('role', 'rowheader');
            corpus.setAttribute('scope', 'row');
            corpus.appendChild(P.el('span', 'iwac-vis-laicite-corpus-name',
                L.subsetLabel(subset)));
            corpus.appendChild(P.el('span', 'iwac-vis-laicite-corpus-gloss',
                P.t('laicite.subset_gloss_' + subset)));
            P.tableCardCell(corpus, 'title');
            tr.appendChild(corpus);

            [['laicite.col_members', v.members],
                ['laicite.col_tagged', v.tagged],
                ['laicite.col_said', v.said],
                ['laicite.col_occurrences', v.occurrences]
            ].forEach(function (pair) {
                var td = cell(null, 'meta', pair[0]);
                td.appendChild(document.createTextNode(P.formatNumber(pair[1] || 0)));
                tr.appendChild(td);
            });

            // The readable share, per corpus. A bare percentage would hide
            // that references sit at 169/9167 while documents sit at 502/502.
            // Its own line in the record layout — the meter needs the width.
            var readable = cell('iwac-vis-laicite-readable', 'row', 'laicite.col_readable');
            var q = v.quotable_occurrences || 0;
            var o = v.occurrences || 0;
            readable.appendChild(P.el('span', 'iwac-vis-laicite-readable-n',
                P.formatNumber(q) + ' / ' + P.formatNumber(o)));
            var meter = P.el('span', 'iwac-vis-laicite-meter');
            var fill = P.el('span', 'iwac-vis-laicite-meter-fill');
            fill.style.width = L.pct(q, o) + '%';
            meter.appendChild(fill);
            readable.appendChild(meter);
            tr.appendChild(readable);

            var span = v.year_range || [];
            var spanCell = cell(null, 'meta', 'laicite.col_span');
            spanCell.appendChild(document.createTextNode(
                span.length === 2 ? span[0] + '–' + span[1] : '—'));
            tr.appendChild(spanCell);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        var wrap = P.el('div', 'iwac-vis-table-wrapper iwac-vis-table-wrapper--cards');
        wrap.appendChild(table);
        panel.appendChild(wrap);
        panel.appendChild(P.el('p', 'iwac-vis-laicite-table-note',
            P.t('laicite.subset_table_note')));
        return panel;
    };

    /**
     * Link from a frame card to the sibling block that covers the same
     * material from another angle, when the lexicon declares one.
     * `E.crossBlockLink` owns the URL and the where-am-I checks.
     *
     * The link TEXT rides in the lexicon beside the target, same as
     * note_en / note_fr — a msgid per slug would have to be added in
     * lockstep with every new `cross_block` and renders the raw key when
     * that is missed.
     */
    function crossBlockLink(spec) {
        var E = ns.embed;
        if (!spec || !E || !E.crossBlockLink) return null;
        var label = (ns.locale === 'fr' ? spec.cross_fr : spec.cross_en)
            || spec.cross_en;
        var link = E.crossBlockLink(spec.cross_block, label);
        if (link) link.className += ' iwac-vis-laicite-frame-cross';
        return link;
    }

    /**
     * The frame legend. Membership frames are marked as such, and a frame
     * that is nearly empty carries the note explaining why it was kept —
     * the absence of the sociological register is a finding, so the panel
     * says so rather than hiding the frame.
     */
    L.buildFrameLegend = function (metadata, frameColors) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-frames');
        panel.appendChild(P.el('h4', null, P.t('laicite.frames_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc', P.t('laicite.frames_desc')));

        var membership = (metadata.membership_rule || {}).frames || [];
        var order = metadata.frame_order || [];
        var byS = metadata.frame_by_subset || {};
        var totalMembers = (metadata.totals || {}).members || 0;

        var grid = P.el('div', 'iwac-vis-laicite-frame-grid');
        order.forEach(function (frame) {
            var card = P.el('div', 'iwac-vis-laicite-frame-card');
            var swatch = P.el('span', 'iwac-vis-laicite-frame-swatch');
            if (frameColors[frame]) swatch.style.backgroundColor = frameColors[frame];
            var head = P.el('div', 'iwac-vis-laicite-frame-head');
            head.appendChild(swatch);
            head.appendChild(P.el('span', 'iwac-vis-laicite-frame-name',
                L.frameLabel(metadata, frame)));
            if (membership.indexOf(frame) !== -1) {
                head.appendChild(L.chip(P.t('laicite.membership_note'),
                    'is-membership'));
            }
            card.appendChild(head);

            // Item share across the whole dossier — the cross-corpus
            // comparable figure. Occurrence totals are per corpus only.
            var items = 0;
            L.SUBSETS.forEach(function (s) {
                items += ((byS[s] || {}).items || {})[frame] || 0;
            });
            card.appendChild(P.el('p', 'iwac-vis-laicite-frame-share',
                P.t('laicite.frame_share', { percent: L.pct(items, totalMembers) })));

            var spec = (metadata.frames || {})[frame] || {};
            var note = (ns.locale === 'fr' ? spec.note_fr : spec.note_en)
                || spec.note_en;
            if (note) {
                card.appendChild(P.el('p', 'iwac-vis-laicite-frame-note', note));
            }
            var cross = crossBlockLink(spec);
            if (cross) card.appendChild(cross);
            grid.appendChild(card);
        });
        panel.appendChild(grid);
        return panel;
    };
})();
