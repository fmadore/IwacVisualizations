/**
 * IWAC Visualizations — Laïcité block: Primary-source dossier (issue #14, view 3).
 *
 * The matching `documents` items rendered as a readable dossier rather than
 * as rows in an aggregate. Small by row count, large by research value:
 * these are statutes, minutes, ministerial reports and petitions — laïcité
 * being negotiated, rather than reported after the fact — and nearly all of
 * them carry public full text.
 *
 * These counts are never averaged into the press figures anywhere: primary
 * sources and press coverage are different evidentiary objects.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite documents: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /**
     * @param {Object} bundle    laicite-documents.json
     * @param {Object} metadata
     * @param {Object} opts      {siteBase, frameColors, onFocusYear}
     */
    L.buildDocumentDossier = function (bundle, metadata, opts) {
        opts = opts || {};
        var docs = (bundle && bundle.documents) || [];
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-docs');
        panel.appendChild(P.el('h4', null, P.t('laicite.documents_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.documents_desc')));

        if (!docs.length) {
            panel.appendChild(P.buildEmptyState('laicite.documents_empty'));
            return panel;
        }

        var list = P.el('ul', 'iwac-vis-laicite-doc-list');
        docs.forEach(function (doc) {
            list.appendChild(buildCard(doc, metadata, opts));
        });
        panel.appendChild(list);
        return panel;
    };

    function buildCard(doc, metadata, opts) {
        var li = P.el('li', 'iwac-vis-laicite-doc');

        var head = P.el('div', 'iwac-vis-laicite-doc-head');
        var titleEl;
        if (doc.url) {
            titleEl = P.el('a', 'iwac-vis-laicite-doc-title', doc.title);
            titleEl.href = doc.url;
        } else {
            titleEl = P.el('span', 'iwac-vis-laicite-doc-title', doc.title);
        }
        head.appendChild(titleEl);
        li.appendChild(head);

        var meta = P.el('p', 'iwac-vis-laicite-doc-meta');
        var bits = [];
        if (doc.date) bits.push(doc.date);
        if (doc.countries && doc.countries.length) bits.push(doc.countries.join(', '));
        if (doc.author) bits.push(doc.author);
        if (doc.nb_pages) bits.push(P.t('laicite.doc_pages', { count: doc.nb_pages }));
        meta.textContent = bits.join(' · ');
        li.appendChild(meta);

        var flags = P.el('div', 'iwac-vis-laicite-doc-flags');
        if (doc.is_tagged) {
            flags.appendChild(L.chip(P.t('laicite.doc_tagged'), 'is-tagged'));
        }
        if (doc.ocr_public && doc.has_text) {
            flags.appendChild(L.chip(P.t('laicite.doc_full_text'), 'is-public'));
        }
        // The year chip is the cross-link into the timeline: clicking it
        // moves the timeline to the year this document was produced, which
        // is how a reader gets from the source to the coverage it generated.
        if (doc.year && opts.onFocusYear) {
            var yearChip = P.el('button', 'iwac-vis-laicite-chip is-year',
                String(doc.year));
            yearChip.type = 'button';
            yearChip.addEventListener('click', function () {
                opts.onFocusYear(doc.year, doc.countries && doc.countries[0]);
            });
            flags.appendChild(yearChip);
        }
        if (flags.childNodes.length) li.appendChild(flags);

        if (doc.description) {
            // AI-generated text gets explicit visual treatment so readers can
            // tell computational artefacts from human-authored archival
            // metadata — the theme's `.property--ai` pattern.
            var ai = P.el('div', 'iwac-vis-laicite-doc-ai');
            ai.appendChild(P.el('span', 'iwac-vis-laicite-ai-badge',
                P.t('laicite.doc_ai_description')));
            ai.appendChild(P.el('p', 'iwac-vis-laicite-doc-desc', doc.description));
            li.appendChild(ai);
        }

        var frames = Object.keys(doc.frame_counts || {});
        if (frames.length) {
            var frameRow = P.el('div', 'iwac-vis-laicite-doc-frames');
            frames.sort(function (a, b) {
                return doc.frame_counts[b] - doc.frame_counts[a];
            }).forEach(function (frame) {
                var chip = L.chip(
                    L.frameLabel(metadata, frame) + ' · ' + doc.frame_counts[frame],
                    'is-frame');
                if (opts.frameColors && opts.frameColors[frame]) {
                    chip.style.borderInlineStartColor = opts.frameColors[frame];
                }
                frameRow.appendChild(chip);
            });
            li.appendChild(frameRow);
        }

        var subjects = (doc.subjects || []).slice(0, 10);
        if (subjects.length) {
            var subjRow = P.el('div', 'iwac-vis-laicite-doc-subjects');
            subjects.forEach(function (s) {
                subjRow.appendChild(L.chip(s, 'is-subject'));
            });
            li.appendChild(subjRow);
        }

        return li;
    }
})();
