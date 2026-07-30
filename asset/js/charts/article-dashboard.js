/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Migrated to the v0.16.0 declarative dashboard-layout system. The
 * `'article'` layout is three slots, preceded by a stat-card row:
 *
 *   0. Article metrics    — words / readability / lexical richness /
 *                            pages / language / LDA topic, built directly
 *                            (not a slot: cards aren't a renderer)
 *   1. Context network    — `iwacArticleNetwork` (the 3-layer force
 *                            graph: article + tagged entities + top
 *                            related articles via shared-entity overlap)
 *   2. Further reading    — `iwacArticleFurther` (toggle between "by
 *                            shared tags", "by similar content" and,
 *                            where the bibliography is embedded, "in the
 *                            scholarship")
 *   3. Spatial coverage   — `iwacArticleMap` (pins for the article's
 *                            geocoded places)
 *
 * The metrics row and the map close a documentation gap rather than
 * adding new data: the generator has always emitted `article.word_count`
 * / `readability` / `lexical_richness` and the geocoded `spatial` array,
 * and the README has always described both views, but neither had a
 * consumer — the payload rode along unread in ~12k files.
 *
 * The AI sentiment panel is rendered server-side in `article.phtml`
 * (CSS dot plots off Omeka item metadata, no chart library) and is NOT
 * part of the dashboardLayout slot list — it needs no orchestrator and
 * no JS at all.
 *
 * Renderer wiring lives in `shared/dashboard-panels-bridge.js`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.dashboardLayout) {
        console.warn('IWACVis article dashboard: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Empty-payload predicates                                          */
    /* ----------------------------------------------------------------- */

    function hasNetworkData(data) {
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];
        return entities.length > 0 || related.length > 0;
    }
    function hasFurtherData(data) {
        return ((data && data.related_by_entities) || []).length > 0
            || ((data && data.semantic_neighbors) || []).length > 0
            || ((data && data.related_scholarship) || []).length > 0;
    }
    function hasSpatialData(data) {
        return ((data && data.spatial) || []).length > 0;
    }

    /* ----------------------------------------------------------------- */
    /*  Article metrics stat cards                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Cards for the numbers the generator has always shipped and nothing
     * has ever read. Built here rather than as a layout slot because
     * `P.buildSummaryCards` formats every value through formatNumber,
     * which mangles strings like a language code or a topic label — the
     * same reason the publication and reference dashboards build their own.
     */
    function buildMetricCards(article) {
        // `text: true` marks a value that is prose rather than a figure, so
        // the card lets it wrap. Without it the LDA topic — six keywords
        // joined by dashes — rendered as one unwrappable line that painted
        // past the card and gave the whole article page a horizontal
        // scrollbar at any viewport narrow enough to squeeze the column.
        var defs = [
            { key: 'word_count',       label: 'Words',    format: P.formatNumber },
            { key: 'readability',      label: 'Readability (Flesch)' },
            // MATTR, not a raw type-token ratio: the label has to match
            // what the upstream column actually is.
            { key: 'lexical_richness', label: 'Lexical richness (MATTR)' },
            { key: 'nb_pages',         label: 'Pages',    format: P.formatNumber },
            { key: 'language',         label: 'Language', text: true },
            { key: 'lda_label',        label: 'Topic',    text: true }
        ];
        var row = P.el('div', 'iwac-vis-overview-summary');
        var rendered = 0;
        defs.forEach(function (d) {
            var v = article ? article[d.key] : null;
            if (v == null || v === '') return;
            var card = P.el('div', 'iwac-vis-summary-card');
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(d.label)));
            card.appendChild(P.el('div',
                'iwac-vis-summary-card__value' + (d.text ? ' iwac-vis-summary-card__value--text' : ''),
                d.format ? d.format(v) : String(v)));
            // The LDA topic is machine output; mark it so a reader can tell
            // it apart from the archival metadata beside it.
            if (d.key === 'lda_label') {
                card.classList.add('iwac-vis-summary-card--generated');
                card.title = P.t('article_topic_generated');
            }
            row.appendChild(card);
            rendered++;
        });
        return rendered > 0 ? row : null;
    }

    /* ----------------------------------------------------------------- */
    /*  Layout                                                            */
    /* ----------------------------------------------------------------- */

    var ALL = DL.fullSlice;

    DL.register('article', [
        { chart: 'iwacArticleNetwork', wide: true, dataAccessor: ALL,
          title: 'Context network',  description: 'desc_article_context_network',
          hasData: hasNetworkData },
        { chart: 'iwacArticleFurther', wide: true, dataAccessor: ALL,
          title: 'Further reading',  description: 'desc_article_further_reading',
          hasData: hasFurtherData },
        { chart: 'iwacArticleMap', wide: true, dataAccessor: ALL,
          title: 'Spatial coverage', description: 'desc_article_spatial',
          hasData: hasSpatialData }
    ]);

    /* ----------------------------------------------------------------- */
    /*  Bootstrap — shared per-item dashboard boot                         */
    /* ----------------------------------------------------------------- */
    //
    // No facet here: the dynamic-panels `__body` wrapper mounts as a
    // sibling of the server-rendered sentiment block already in
    // article.phtml, which needs no orchestrator step of its own. The
    // metrics row rides in through `mountHeader`, which the boot helper
    // calls with the body wrapper before the slots render.

    P.bootPerItemDashboard({
        selector:   '.iwac-vis-article',
        classToken: 'article',
        dataDir:    'article-dashboards',
        layout:     'article',
        warnLabel:  'IWACVis article dashboard',
        mountHeader: function (body, data) {
            var cards = buildMetricCards(data && data.article);
            if (cards) body.appendChild(cards);
        }
    });
})();
