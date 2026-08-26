/**
 * IWAC Visualizations — Audiovisual Overview: most-recent panel
 *
 * Renders `data.recent` through the shared `P.buildTable` rather than a
 * bespoke poster grid: this module already has one pattern for "a list of
 * items with a still image and a link", it is paginated, keyboard-reachable
 * and localized, and a second pattern for the same job would be a second
 * thing to keep in step for no gain the reader can see.
 *
 * **The link target is not guessable, which is why the generator resolves
 * it.** The two populations differ: a web video has no media file at all
 * (its `PDF` is empty and its IIIF manifest carries zero canvases), so its
 * external URL is the only playable target; a deposited recording has a real
 * file. Both always carry the collection page as a fallback. This panel
 * therefore reads the single `url` the generator settled on and never
 * reconstructs one from an id.
 *
 * Load order: after shared/panels.js, shared/pagination.js and
 * shared/table.js; before the audiovisual-overview orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.audiovisual-overview/recent: missing dependencies');
        return;
    }

    function render(chartEl, data) {
        var items = (data && data.recent) || [];
        if (!items.length) {
            chartEl.appendChild(P.buildEmptyState());
            return;
        }

        var rows = items.map(function (it) {
            return {
                thumbnail:   it.thumbnail || '',
                title:       it.title || '',
                url:         it.url || it.iwac_url || '',
                channel:     it.channel || '',
                source_type: it.source_type || '',
                // Pre-formatted: buildTable has no per-column formatter, and
                // a raw second count in a table cell is unreadable.
                duration:    P.formatDuration(it.seconds),
                date:        it.date || ''
            };
        });

        var tbl = P.buildTable({
            columns: [
                { key: 'thumbnail',   label: '',                       render: 'thumbnail', width: '72px' },
                { key: 'title',       label: P.t('Title'),             render: 'link', linkKey: 'url' },
                // 'Source', not the panel's plural 'Sources': this cell names
                // one channel. And 'Duration', not 'av.runtime' ("Total
                // runtime") — the cell carries one recording's length, so the
                // aggregate label would state the wrong quantity.
                { key: 'channel',     label: P.t('Source') },
                { key: 'source_type', label: '',                       render: 'badge', i18nPrefix: 'av.source_' },
                { key: 'duration',    label: P.t('Duration'),          width: '90px' },
                { key: 'date',        label: P.t('Date'),              render: 'date', width: '130px' }
            ],
            rows: rows,
            pageSize: 12,
            className: 'iwac-vis-table--recent'
        });

        chartEl.appendChild(tbl.root);
    }

    ns.audiovisualOverview = ns.audiovisualOverview || {};
    ns.audiovisualOverview.recent = { render: render };
})();
