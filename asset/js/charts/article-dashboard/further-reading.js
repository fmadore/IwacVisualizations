/**
 * IWAC Visualizations — Article Dashboard: "Further reading" panel
 *
 * Single panel that replaces the earlier separate "Related articles"
 * and "Similar articles" cards. The reader picks one of two ways to
 * see more articles from the collection:
 *
 *   1. "By shared tags"     → articles that share the most tagged
 *                              people, places, organisations, or
 *                              subjects with this one (metadata join
 *                              over the IWAC authority index).
 *   2. "By similar content" → articles whose full text reads
 *                              similarly, even if the tags are
 *                              different (AI language model compared
 *                              the whole OCR'd article text).
 *   3. "In the scholarship"  → works from the IWAC bibliography whose
 *                              text reads similarly. Same comparison as
 *                              (2) but across corpora: the references
 *                              subset carries embeddings from the same
 *                              model in the same space, so a press
 *                              article can be matched against the
 *                              academic literature about it. Appears
 *                              only when the bundle carries the key,
 *                              since the pipeline may not have embedded
 *                              the bibliography yet.
 *
 * All views render as the same card grid (thumbnail, title, meta line,
 * badge) so the visual language stays consistent and only the badge's
 * meaning + colour and the meta line's contents change between tabs.
 * The toggle is built with the existing `P.buildFacetButtons` helper so
 * keyboard + touch controls are already handled.
 *
 * Click target: the whole card is an `<a href="/item/<o_id>">` so
 * tab-navigation + right-click "open in new tab" + keyboard ENTER
 * all work without the panel having to wire click handlers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons) {
        console.warn('IWACVis.article-dashboard/further-reading: missing panels or facet-buttons');
        return;
    }

    /** Inline SVG document icon used when no thumbnail is available. */
    function buildThumbPlaceholder() {
        var ph = P.el('div', 'iwac-vis-article-card__placeholder');
        ph.setAttribute('aria-hidden', 'true');
        ph.innerHTML =
            '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"' +
            ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/></svg>';
        return ph;
    }

    /**
     * Build one card. `badge` is rendered as-is inside the thumbnail's
     * top-right overlay and carries variant-specific CSS (orange accent
     * for similarity, blue accent for shared tags). `metaParts` overrides
     * the meta line — a scholarly work's line is authors · type · year,
     * not newspaper · country · date.
     */
    function buildCard(article, badge, siteBase, metaParts) {
        var card = document.createElement('a');
        card.className = 'iwac-vis-article-card';
        card.href = (siteBase || '') + '/item/' + article.o_id;

        var thumb = P.el('div', 'iwac-vis-article-card__thumb');
        if (article.thumbnail) {
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = article.thumbnail;
            img.addEventListener('error', function () {
                img.replaceWith(buildThumbPlaceholder());
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(buildThumbPlaceholder());
        }
        if (badge) thumb.appendChild(badge);
        card.appendChild(thumb);

        var body = P.el('div', 'iwac-vis-article-card__body');
        var title = P.el('div', 'iwac-vis-article-card__title');
        title.textContent = article.title || ('#' + article.o_id);
        body.appendChild(title);

        var parts = metaParts;
        if (!parts) {
            parts = [];
            if (article.newspaper) parts.push(article.newspaper);
            if (article.country)   parts.push(article.country);
            if (article.date)      parts.push(P.formatDate(article.date));
        }
        body.appendChild(P.el('div', 'iwac-vis-article-card__meta', parts.join(' · ')));

        card.appendChild(body);
        return card;
    }

    // -------------------- Tag view (shared entities) --------------------
    function renderTagView(gridHost, related, entityTitleMap, siteBase) {
        gridHost.innerHTML = '';
        if (!related.length) {
            gridHost.appendChild(P.buildEmptyState('No related articles'));
            return;
        }
        related.forEach(function (r) {
            var badge = null;
            if (r.shared_count) {
                badge = P.el('span', 'iwac-vis-article-card__shared',
                    P.t('shares_n_entities', { count: r.shared_count }));
                var names = (r.shared || [])
                    .map(function (id) { return entityTitleMap[id]; })
                    .filter(Boolean);
                if (names.length) badge.title = P.t('Shares') + ': ' + names.join(', ');
            }
            gridHost.appendChild(buildCard(r, badge, siteBase));
        });
    }

    // -------------------- Content view (semantic neighbours) ------------
    function renderContentView(gridHost, neighbours, siteBase) {
        gridHost.innerHTML = '';
        if (!neighbours.length) {
            gridHost.appendChild(P.buildEmptyState('No similar articles'));
            return;
        }
        neighbours.forEach(function (n) {
            var badge = null;
            if (typeof n.similarity === 'number') {
                var pct = Math.round(n.similarity * 1000) / 10;
                badge = P.el('span', 'iwac-vis-article-card__sim', pct.toFixed(0) + '%');
                badge.setAttribute('title', P.t('Similarity') + ': ' + pct.toFixed(1) + '%');
            }
            gridHost.appendChild(buildCard(n, badge, siteBase));
        });
    }

    // -------------------- Scholarship view (cross-corpus kNN) -----------
    function renderScholarshipView(gridHost, works, siteBase) {
        gridHost.innerHTML = '';
        if (!works.length) {
            gridHost.appendChild(P.buildEmptyState('No related scholarship'));
            return;
        }
        works.forEach(function (w) {
            var badge = null;
            if (typeof w.similarity === 'number') {
                var pct = Math.round(w.similarity * 1000) / 10;
                badge = P.el('span', 'iwac-vis-article-card__sim', pct.toFixed(0) + '%');
                badge.setAttribute('title', P.t('Similarity') + ': ' + pct.toFixed(1) + '%');
            }
            // Authors · type · year. The type arrives as the French
            // resource-class label the dataset stores, so it routes through
            // the same `ref_type_*` keys the References Overview uses.
            var parts = [];
            if (w.authors && w.authors.length) parts.push(w.authors.join(', '));
            if (w.type) parts.push(P.translateKeyed('ref_type_', w.type));
            if (w.date) parts.push(String(w.date).slice(0, 4));
            gridHost.appendChild(buildCard(w, badge, siteBase, parts));
        });
    }

    function render(panelEl, data, facet, ctx) {
        var related     = (data && data.related_by_entities) || [];
        var neighbours  = (data && data.semantic_neighbors) || [];
        var scholarship = (data && data.related_scholarship) || [];
        var entities    = (data && data.entities) || [];
        var siteBase    = (ctx && ctx.siteBase) || '';

        // Build an o_id → title lookup for the shared-entities tooltip.
        var entityTitleMap = {};
        entities.forEach(function (e) { entityTitleMap[e.o_id] = e.title; });

        var host = panelEl.chart;
        host.innerHTML = '';

        // If no signal has anything to show, collapse the whole panel body
        // to an empty state.
        if (!related.length && !neighbours.length && !scholarship.length) {
            host.appendChild(P.buildEmptyState('No further reading found'));
            return;
        }

        // ---- Controls row: tabs + per-tab caption ----
        var controls = P.el('div', 'iwac-vis-further__controls');
        var tabsHost = P.el('div', 'iwac-vis-further__tabs');
        controls.appendChild(tabsHost);

        var caption = P.el('p', 'iwac-vis-further__caption');
        controls.appendChild(caption);
        host.appendChild(controls);

        // ---- Grid host ----
        var grid = P.el('div', 'iwac-vis-article-cards iwac-vis-further__grid');
        host.appendChild(grid);

        // Default view: prefer the tag view (because it's literal and
        // explainable: "same people / places"). If the article has no
        // related-by-tag hits but has semantic neighbours, open on
        // the content tab so the panel isn't a dead end.
        var startKey = related.length ? 'tags' : 'content';

        function setView(key) {
            if (key === 'tags') {
                caption.textContent = P.t('desc_further_reading_tags');
                renderTagView(grid, related, entityTitleMap, siteBase);
            } else if (key === 'scholarship') {
                caption.textContent = P.t('desc_further_reading_scholarship');
                renderScholarshipView(grid, scholarship, siteBase);
            } else {
                caption.textContent = P.t('desc_further_reading_content');
                renderContentView(grid, neighbours, siteBase);
            }
        }

        // The two article toggles always appear: when one has zero data the
        // view renders an empty state, so the reader still learns the option
        // existed and simply wasn't fruitful here. The scholarship tab is
        // conditional instead — the generator omits the key entirely when the
        // bibliography has no embeddings, and offering a tab that can never
        // have contents would advertise a feature the data doesn't support.
        var facets = [
            { key: 'tags',    label: P.t('By shared tags') },
            { key: 'content', label: P.t('By similar content') }
        ];
        if (scholarship.length) {
            facets.push({ key: 'scholarship', label: P.t('In the scholarship') });
        }

        var ctrl = P.buildFacetButtons({
            facets: facets,
            activeKey: startKey,
            onChange: function (e) { setView(e.facet); }
        });
        tabsHost.appendChild(ctrl.root);

        setView(startKey);
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.furtherReading = { render: render };
})();
