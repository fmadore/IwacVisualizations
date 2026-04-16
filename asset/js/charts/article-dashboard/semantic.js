/**
 * IWAC Visualizations — Article Dashboard: similar articles card grid
 *
 * Card-based gallery of the top-K articles semantically closest to
 * the current one (cosine similarity over Gemini OCR embeddings).
 * Each card surfaces:
 *
 *   - Thumbnail (medium, lazy-loaded, graceful fallback)
 *   - Title (2-line clamp)
 *   - Newspaper · country · date
 *   - Similarity as a percentage badge
 *   - Whole card is the click target → the other article's page
 *
 * Replaces the earlier horizontal-bar-chart implementation which the
 * user (rightly) flagged as ugly and non-readable for a "what else
 * should I read next" use case.
 *
 * Responsive grid: `repeat(auto-fill, minmax(220px, 1fr))` handled by
 * CSS — the JS only emits DOM nodes. Cards are <a> elements so
 * keyboard tab-navigation + right-click "open in new tab" work for
 * free without having to wire up a click handler.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.article-dashboard/semantic: missing panels');
        return;
    }

    /**
     * Build a single similar-article card as an <a>. The whole card is
     * the link; nested text is not an interactive descendant, so the
     * tab stop is the card itself.
     */
    function buildCard(neighbour, siteBase) {
        var card = document.createElement('a');
        card.className = 'iwac-vis-article-card';
        card.href = (siteBase || '') + '/item/' + neighbour.o_id;

        // ---- Thumbnail ----
        var thumb = P.el('div', 'iwac-vis-article-card__thumb');
        if (neighbour.thumbnail) {
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';                   // decorative; title is below
            img.src = neighbour.thumbnail;
            img.addEventListener('error', function () {
                // Swap the broken img for a document-icon placeholder
                // so we don't leak alt-text boxes or broken-image icons.
                img.replaceWith(buildThumbPlaceholder());
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(buildThumbPlaceholder());
        }

        // Similarity percentage badge — overlaid top-right on the thumb
        // so the list reads like "item + how close it is" at a glance.
        if (typeof neighbour.similarity === 'number') {
            var pct = Math.round(neighbour.similarity * 1000) / 10;
            var badge = P.el('span', 'iwac-vis-article-card__sim', pct.toFixed(1) + '%');
            badge.setAttribute('title', P.t('Similarity') + ': ' + pct.toFixed(1) + '%');
            thumb.appendChild(badge);
        }
        card.appendChild(thumb);

        // ---- Text body ----
        var body = P.el('div', 'iwac-vis-article-card__body');

        var title = P.el('div', 'iwac-vis-article-card__title');
        title.textContent = neighbour.title || ('#' + neighbour.o_id);
        body.appendChild(title);

        var meta = P.el('div', 'iwac-vis-article-card__meta');
        var metaParts = [];
        if (neighbour.newspaper) metaParts.push(neighbour.newspaper);
        if (neighbour.country)   metaParts.push(neighbour.country);
        if (neighbour.date)      metaParts.push(P.formatDate(neighbour.date));
        meta.textContent = metaParts.join(' · ');
        body.appendChild(meta);

        card.appendChild(body);
        return card;
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

    function render(panelEl, data, facet, ctx) {
        var neighbours = (data && data.semantic_neighbors) || [];
        var siteBase = (ctx && ctx.siteBase) || '';

        var host = panelEl.chart;
        host.innerHTML = '';

        if (!neighbours.length) {
            host.appendChild(P.el('div', 'iwac-vis-empty', P.t('No similar articles')));
            return;
        }

        var grid = P.el('div', 'iwac-vis-article-cards');
        neighbours.forEach(function (n) {
            grid.appendChild(buildCard(n, siteBase));
        });
        host.appendChild(grid);
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.semantic = { render: render };
})();
