/**
 * IWAC Visualizations — Article Dashboard: related-by-entities cards
 *
 * Card grid mirroring the "similar articles" (semantic) panel but
 * ranked by SHARED-ENTITY count rather than embedding cosine.
 *
 *   - Semantic panel  → "thematically similar" (Gemini OCR embeddings)
 *   - Related panel   → "share the same people / places / subjects"
 *
 * Both read well side-by-side and give the reader two
 * complementary "what should I read next?" angles without muddying
 * either one. Visually identical to semantic cards except:
 *
 *   - Badge shows "N partagées" / "N shared" instead of a percentage
 *   - Hover tooltip lists the first 3 shared entities by title
 *
 * The shared-entity id list is resolved against data.entities so we
 * render real names instead of numeric o_ids in the tooltip.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.article-dashboard/related: missing panels');
        return;
    }

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

    function buildCard(related, entityTitleMap, siteBase) {
        var card = document.createElement('a');
        card.className = 'iwac-vis-article-card';
        card.href = (siteBase || '') + '/item/' + related.o_id;

        var thumb = P.el('div', 'iwac-vis-article-card__thumb');
        if (related.thumbnail) {
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.src = related.thumbnail;
            img.addEventListener('error', function () {
                img.replaceWith(buildThumbPlaceholder());
            });
            thumb.appendChild(img);
        } else {
            thumb.appendChild(buildThumbPlaceholder());
        }

        // Badge with shared-entity count. Distinct class from the
        // semantic panel (`iwac-vis-article-card__sim` is orange) so
        // the two panels read as different signals — this one is the
        // "blue sibling" (styled via --iwac-vis-card-badge-shared).
        if (related.shared_count) {
            var badge = P.el('span', 'iwac-vis-article-card__shared',
                P.t('shares_n_entities', { count: related.shared_count }));
            // Tooltip resolves shared o_ids to entity names when
            // available — readers see "Shares: Bénin, Islam, Radio"
            // instead of just a count.
            var sharedNames = (related.shared || [])
                .map(function (id) { return entityTitleMap[id]; })
                .filter(Boolean);
            if (sharedNames.length) {
                badge.title = P.t('Shares') + ': ' + sharedNames.join(', ');
            }
            thumb.appendChild(badge);
        }
        card.appendChild(thumb);

        var body = P.el('div', 'iwac-vis-article-card__body');
        var title = P.el('div', 'iwac-vis-article-card__title');
        title.textContent = related.title || ('#' + related.o_id);
        body.appendChild(title);

        var metaParts = [];
        if (related.newspaper) metaParts.push(related.newspaper);
        if (related.country)   metaParts.push(related.country);
        if (related.date)      metaParts.push(P.formatDate(related.date));
        body.appendChild(P.el('div', 'iwac-vis-article-card__meta', metaParts.join(' · ')));

        card.appendChild(body);
        return card;
    }

    function render(panelEl, data, facet, ctx) {
        var related = (data && data.related_by_entities) || [];
        var entities = (data && data.entities) || [];
        var siteBase = (ctx && ctx.siteBase) || '';

        // Build o_id → title lookup for the shared-entities tooltip.
        var entityTitleMap = {};
        entities.forEach(function (e) { entityTitleMap[e.o_id] = e.title; });

        var host = panelEl.chart;
        host.innerHTML = '';

        if (!related.length) {
            host.appendChild(P.el('div', 'iwac-vis-empty', P.t('No related articles')));
            return;
        }

        var grid = P.el('div', 'iwac-vis-article-cards');
        related.forEach(function (r) {
            grid.appendChild(buildCard(r, entityTitleMap, siteBase));
        });
        host.appendChild(grid);
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.related = { render: render };
})();
