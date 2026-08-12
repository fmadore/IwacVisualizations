/**
 * IWAC Visualizations — Press Language block: i18n strings.
 *
 * Split out of lexical-metrics.js (scary-terms pattern) so the
 * orchestrator carries logic, not a translation table; loaded before the
 * orchestrator via the phtml `panels` list.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

        ns.addTranslations('en', {
            'Loading press language metrics': 'Loading press language metrics',
            'lexical.mean_readability':       'Average readability (Flesch)',
            'lexical.mean_richness':          'Average lexical richness',
            'lexical.mean_words':             'Average words per article',
            'lexical.readability_title':      'Readability over time',
            'lexical.readability_desc':       'Average Flesch reading-ease score (French adaptation) of the articles published each year, computed from the scanned text. The higher the score, the easier the article is to read.',
            'lexical.richness_title':         'Lexical richness over time',
            'lexical.richness_desc':          'Average lexical richness of the articles published each year, computed from the scanned text. The measure is MATTR, which counts how many different words appear in each 50-word stretch of an article. The higher the value, the more varied the vocabulary. MATTR holds steady as an article gets longer, so long and short articles are directly comparable; articles under 50 words are left unscored.',
            'lexical.words_title':            'Article length over time',
            'lexical.words_desc':             'Average number of words per article published each year, counted from the scanned text.',
            'lexical.np_read_title':          'Newspapers by readability',
            'lexical.np_read_desc':           'Newspapers with at least {min} articles, ranked by their average Flesch reading-ease score, computed from the scanned text (top {top}). The higher the score, the easier the articles are to read.',
            'lexical.np_rich_title':          'Newspapers by lexical richness',
            'lexical.np_rich_desc':           'Newspapers with at least {min} articles, ranked by their average lexical richness (MATTR), computed from the scanned text (top {top}). The higher the value, the more varied the vocabulary.',
            'lexical.axis_readability':       'Flesch score',
            'lexical.axis_richness':          'MATTR'
        });
        ns.addTranslations('fr', {
            'Loading press language metrics': 'Chargement des indicateurs de langue',
            'lexical.mean_readability':       'Lisibilité moyenne (Flesch)',
            'lexical.mean_richness':          'Richesse lexicale moyenne',
            'lexical.mean_words':             'Mots par article (moyenne)',
            'lexical.readability_title':      'Lisibilité au fil du temps',
            'lexical.readability_desc':       'Score moyen de lisibilit\u00e9 Flesch (adaptation fran\u00e7aise) des articles publi\u00e9s chaque ann\u00e9e, calcul\u00e9 \u00e0 partir du texte num\u00e9ris\u00e9. Plus le score est \u00e9lev\u00e9, plus l\u2019article est facile \u00e0 lire.',
            'lexical.richness_title':         'Richesse lexicale au fil du temps',
            'lexical.richness_desc':          'Richesse lexicale moyenne des articles publi\u00e9s chaque ann\u00e9e, calcul\u00e9e \u00e0 partir du texte num\u00e9ris\u00e9. La mesure employ\u00e9e, le MATTR, compte le nombre de mots diff\u00e9rents dans chaque fen\u00eatre de 50 mots de l\u2019article. Plus la valeur est \u00e9lev\u00e9e, plus le vocabulaire est vari\u00e9. Le MATTR ne varie pas avec la longueur de l\u2019article, si bien que les articles longs et courts sont directement comparables ; ceux de moins de 50 mots ne sont pas not\u00e9s.',
            'lexical.words_title':            'Longueur des articles au fil du temps',
            'lexical.words_desc':             'Nombre moyen de mots par article publi\u00e9 chaque ann\u00e9e, compt\u00e9 \u00e0 partir du texte num\u00e9ris\u00e9.',
            'lexical.np_read_title':          'Journaux par lisibilité',
            'lexical.np_read_desc':           'Journaux comptant au moins {min} articles, class\u00e9s par score moyen de lisibilit\u00e9 Flesch calcul\u00e9 \u00e0 partir du texte num\u00e9ris\u00e9 (top {top}). Plus le score est \u00e9lev\u00e9, plus les articles sont faciles \u00e0 lire.',
            'lexical.np_rich_title':          'Journaux par richesse lexicale',
            'lexical.np_rich_desc':           'Journaux comptant au moins {min} articles, class\u00e9s par richesse lexicale moyenne (MATTR) calcul\u00e9e \u00e0 partir du texte num\u00e9ris\u00e9 (top {top}). Plus la valeur est \u00e9lev\u00e9e, plus le vocabulaire est vari\u00e9.',
            'lexical.axis_readability':       'Score Flesch',
            'lexical.axis_richness':          'MATTR'
        });
})();
