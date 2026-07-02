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
            'lexical.mean_readability':       'Mean readability (Flesch)',
            'lexical.mean_richness':          'Mean lexical richness',
            'lexical.mean_words':             'Mean words per article',
            'lexical.readability_title':      'Readability over time',
            'lexical.readability_desc':       'Mean Flesch reading-ease score (French adaptation) of the articles published each year, computed from the OCR text. Higher = easier to read.',
            'lexical.richness_title':         'Lexical richness over time',
            'lexical.richness_desc':          'Mean type-token ratio (distinct words ÷ total words) of the articles published each year, computed from the OCR text. Higher = more varied vocabulary.',
            'lexical.words_title':            'Article length over time',
            'lexical.words_desc':             'Mean number of words per article published each year, counted from the OCR text.',
            'lexical.np_read_title':          'Newspapers by readability',
            'lexical.np_read_desc':           'Newspapers with at least {min} articles, ranked by mean Flesch reading-ease score computed from the OCR text (top {top}). Higher = easier to read.',
            'lexical.np_rich_title':          'Newspapers by lexical richness',
            'lexical.np_rich_desc':           'Newspapers with at least {min} articles, ranked by mean type-token ratio computed from the OCR text (top {top}). Higher = more varied vocabulary.',
            'lexical.axis_readability':       'Flesch score',
            'lexical.axis_richness':          'Type-token ratio'
        });
        ns.addTranslations('fr', {
            'Loading press language metrics': 'Chargement des indicateurs de langue',
            'lexical.mean_readability':       'Lisibilité moyenne (Flesch)',
            'lexical.mean_richness':          'Richesse lexicale moyenne',
            'lexical.mean_words':             'Mots par article (moyenne)',
            'lexical.readability_title':      'Lisibilité au fil du temps',
            'lexical.readability_desc':       'Score moyen de lisibilité Flesch (adaptation française) des articles publiés chaque année, calculé à partir du texte océrisé. Plus le score est élevé, plus le texte est facile à lire.',
            'lexical.richness_title':         'Richesse lexicale au fil du temps',
            'lexical.richness_desc':          'Ratio types-occurrences moyen (mots distincts ÷ mots totaux) des articles publiés chaque année, calculé à partir du texte océrisé. Plus le ratio est élevé, plus le vocabulaire est varié.',
            'lexical.words_title':            'Longueur des articles au fil du temps',
            'lexical.words_desc':             'Nombre moyen de mots par article publié chaque année, compté à partir du texte océrisé.',
            'lexical.np_read_title':          'Journaux par lisibilité',
            'lexical.np_read_desc':           'Journaux comptant au moins {min} articles, classés par score moyen de lisibilité Flesch calculé à partir du texte océrisé (top {top}). Plus le score est élevé, plus le texte est facile à lire.',
            'lexical.np_rich_title':          'Journaux par richesse lexicale',
            'lexical.np_rich_desc':           'Journaux comptant au moins {min} articles, classés par ratio types-occurrences moyen calculé à partir du texte océrisé (top {top}). Plus le ratio est élevé, plus le vocabulaire est varié.',
            'lexical.axis_readability':       'Score Flesch',
            'lexical.axis_richness':          'Ratio types-occurrences'
        });
})();
