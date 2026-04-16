/**
 * IWAC Visualizations — Article Dashboard: metadata stats row
 *
 * Compact "stat cards" row built from the precomputed `article` block:
 *
 *   Word count | Readability | Lexical richness | Pages | Language | Topic
 *
 * Cards with missing / null values are silently skipped so articles
 * without OCR metrics or an assigned LDA topic don't render an "—"
 * graveyard. The Topic card gets an extra `--wide` modifier because
 * the LDA label is a long French phrase.
 *
 * Unlike the person / entity dashboards the article view has no role
 * facet; we still accept the facet arg for API symmetry with the
 * shared panel contract, but never subscribe.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.article-dashboard/stats: missing panels');
        return;
    }

    /**
     * Format a lexical-richness TTR (0..1) as a percentage with one
     * decimal. Numbers above 1 pass through as-is — safety net for
     * future scoring metrics that don't clamp to [0,1].
     */
    function formatTTR(value) {
        if (typeof value !== 'number' || !isFinite(value)) return null;
        if (value >= 0 && value <= 1) {
            return (value * 100).toFixed(1) + '%';
        }
        return value.toFixed(2);
    }

    /**
     * Format a Flesch-ish readability score as an integer. The scale
     * tolerates values outside 0..100 (French texts can score above
     * 100 on the raw formula), so we just round.
     */
    function formatReadability(value) {
        if (typeof value !== 'number' || !isFinite(value)) return null;
        return Math.round(value).toString();
    }

    function buildCard(valueText, labelKey, modifier) {
        var card = P.el('div', 'iwac-vis-summary-card' + (modifier ? ' ' + modifier : ''));
        card.appendChild(P.el('div', 'iwac-vis-summary-card__value', valueText));
        card.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(labelKey)));
        return card;
    }

    function render(host, data /*, facet */) {
        var article = (data && data.article) || {};
        var cards = P.el('div', 'iwac-vis-overview-summary iwac-vis-article-stats');

        if (typeof article.word_count === 'number') {
            cards.appendChild(buildCard(P.formatNumber(article.word_count), 'Word count'));
        }
        var readability = formatReadability(article.readability);
        if (readability != null) {
            cards.appendChild(buildCard(readability, 'Readability'));
        }
        var ttr = formatTTR(article.lexical_richness);
        if (ttr != null) {
            cards.appendChild(buildCard(ttr, 'Lexical richness'));
        }
        if (typeof article.nb_pages === 'number') {
            cards.appendChild(buildCard(P.formatNumber(article.nb_pages), 'Pages'));
        }
        if (article.language) {
            // Language strings come from the dataset in French
            // ("Français"); t() falls back to the raw value for unknown
            // locale keys, so English users see "French" via the
            // lang_Français entry and French users get the pass-through.
            cards.appendChild(buildCard(P.t('lang_' + article.language), 'Language'));
        }
        if (article.lda_label) {
            cards.appendChild(buildCard(
                article.lda_label,
                'Topic',
                'iwac-vis-summary-card--wide'
            ));
        }

        host.innerHTML = '';
        if (cards.children.length === 0) {
            host.appendChild(P.buildEmptyState
                ? P.buildEmptyState()
                : P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }
        host.appendChild(cards);
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.stats = { render: render };
})();
