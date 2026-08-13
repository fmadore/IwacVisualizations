/**
 * IWAC Visualizations — Similar-items strip renderer
 *
 * Renders semantic-kNN neighbours as a horizontal grid of cards. Ships
 * no ECharts at all — a card grid is plain DOM + CSS — so per-article
 * pages don't pay for a charting library to lay out 8 cards.
 *
 * Designed for precomputed top-K cosine neighbours. The articles
 * generator (`generate_article_dashboards.py`) already produces the
 * required shape under each per-article JSON's `semantic_neighbors`
 * key — wire a slot to it via `dataKey: 'semantic_neighbors'`.
 *
 * Accepted item shapes (the renderer normalizes to a common form):
 *
 *     // Native — produced by IWAC generators
 *     { o_id, title, similarity, newspaper?, country?, date?, thumbnail? }
 *
 *     // Generic — used by other consumers / future generators
 *     { id, title, score, source?, type?, date?, snippet?, thumbnail? }
 *
 * The renderer only formats; `ctx.siteBase` is required to build
 * click-through URLs to `/item/{id}`.
 *
 * Slot options:
 *   - `max`         (number)  Cap rendered cards. Default 8.
 *   - `lowSignal`   (number)  Hide neighbours below this score (0–1).
 *                             Default 0.4 — embeddings of very short
 *                             items produce noisy "similar" results.
 *
 * Registered as `similarItems`. Predicate: array of length ≥ 1 with
 * any neighbour above lowSignal threshold.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.similar-items: dashboard-layout.js + panels.js must load first');
        return;
    }

    /**
     * Card types arrive as raw labels, and which family they belong to
     * depends on the strip: the corpus-level slugs the collection charts
     * use (`article`, `image`, …) on some, the French resource-class label
     * the bibliography ships (`Chapitre`, `Compte rendu`) on others. Try
     * both key families before falling back to the raw value.
     *
     * `P.t` echoes an unknown key back verbatim, so the previous
     * `P.t('item_type_' + type) || item.type` never reached its fallback —
     * it printed the key itself ("item_type_Chapitre") on every reference
     * card. `P.translateKeyed` does that comparison properly.
     */
    function typeLabel(type) {
        var viaItem = P.translateKeyed('item_type_', type);
        if (viaItem !== type) return viaItem;
        return P.translateKeyed('ref_type_', type);
    }

    function fmtScore(score) {
        if (typeof score !== 'number' || isNaN(score)) return '';
        var pct = Math.round(score * 100);
        if (pct < 1)   pct = 1;
        if (pct > 99) pct = 99;
        return pct + '%';
    }

    /** Normalize either generator output (`o_id`, `similarity`,
     *  `newspaper`) or generic-shape (`id`, `score`, `source`) into a
     *  single internal field set so the card builder doesn't branch.
     *
     *  `source` and `publisher` stay separate rather than collapsing
     *  into one "where it came from" field: on the audiovisual subset
     *  they are genuinely different properties — dcterms:source (which
     *  only the deposited recordings carry) and the depositing body or
     *  YouTube channel — and a card that prints one under the other's
     *  meaning is telling the reader something untrue. */
    function normalize(item) {
        if (!item) return null;
        return {
            id:        item.id != null ? item.id : item.o_id,
            title:     item.title || '',
            score:     item.score != null ? item.score : item.similarity,
            type:      item.type,
            source:    item.source || item.newspaper,
            publisher: item.publisher,
            country:   item.country,
            date:      item.date,
            duration:  item.duration,
            snippet:   item.snippet,
            thumbnail: item.thumbnail
        };
    }

    function buildCard(raw, ctx) {
        var item = normalize(raw);
        if (!item) return null;

        var card = P.el('a', 'iwac-vis-similar-card');
        if (item.id != null && ctx && ctx.siteBase) {
            card.href = ctx.siteBase + '/item/' + encodeURIComponent(item.id);
        } else {
            card.href = '#';
            card.setAttribute('aria-disabled', 'true');
        }
        card.rel = 'noopener';

        // Runtime rides on the thumbnail when there is one — the video
        // convention, and it keeps the meta line free for provenance.
        // Cards without a thumbnail fall back to a meta bit below.
        var runtime = P.formatDuration ? P.formatDuration(item.duration) : '';

        if (item.thumbnail) {
            var thumb = P.el('span', 'iwac-vis-similar-card__thumb');
            thumb.style.backgroundImage = 'url(' + JSON.stringify(item.thumbnail).slice(1, -1) + ')';
            if (runtime) {
                thumb.appendChild(P.el('span', 'iwac-vis-similar-card__duration', runtime));
            }
            card.appendChild(thumb);
        }

        var body = P.el('span', 'iwac-vis-similar-card__body');

        if (item.score != null) {
            body.appendChild(P.el(
                'span',
                'iwac-vis-similar-card__score',
                P.t('Similarity') + ' ' + fmtScore(item.score)
            ));
        }

        body.appendChild(P.el('span', 'iwac-vis-similar-card__title', item.title || P.t('Untitled')));

        var bits = [];
        if (item.type)    bits.push(typeLabel(item.type));
        if (item.source)  bits.push(item.source);
        if (item.publisher && item.publisher !== item.source) bits.push(item.publisher);
        if (item.country) bits.push(item.country);
        if (item.date)    bits.push(P.formatDate(item.date));
        if (runtime && !item.thumbnail) bits.push(runtime);
        if (bits.length) {
            body.appendChild(P.el('span', 'iwac-vis-similar-card__meta', bits.join(' · ')));
        }

        if (item.snippet) {
            body.appendChild(P.el('span', 'iwac-vis-similar-card__snippet', item.snippet));
        }

        card.appendChild(body);
        return card;
    }

    DL.registerRenderer('similarItems', function (el, data, slot, ctx) {
        // Card strips size to their content — drop the 320px ECharts
        // floor so a short strip doesn't float in a tall empty panel.
        el.classList.add('iwac-vis-chart--auto');

        var opts = (slot && slot.options) || {};
        var max = opts.max != null ? opts.max : 8;
        var lowSignal = opts.lowSignal != null ? opts.lowSignal : 0.4;

        var items = Array.isArray(data) ? data : [];
        var filtered = items.filter(function (it) {
            if (!it) return false;
            var s = it.score != null ? it.score : it.similarity;
            return s == null ? true : s >= lowSignal;
        }).slice(0, max);

        if (filtered.length === 0) {
            el.appendChild(P.buildEmptyState('No similar articles'));
            return;
        }

        // Don't auto-attach the panel-toolbar download — capturing a
        // grid of links to a PNG isn't useful here.
        var panel = el.closest && el.closest('.iwac-vis-panel');
        if (panel) panel.setAttribute('data-iwac-no-panel-toolbar', '1');

        var grid = P.el('div', 'iwac-vis-similar-strip');
        for (var i = 0; i < filtered.length; i++) {
            var card = buildCard(filtered[i], ctx);
            if (card) grid.appendChild(card);
        }
        el.appendChild(grid);
    });

    DL.registerMetadata('similarItems', {
        labelKey: 'Related articles',
        descKey:  'desc_similar_items',
        hasData:  function (v) {
            return Array.isArray(v) && v.length > 0;
        }
    });
})();
