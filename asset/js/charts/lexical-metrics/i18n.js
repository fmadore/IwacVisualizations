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
            'lexical.mean_richness':          'Average vocabulary diversity',
            'lexical.mean_words':             'Average words per article',
            'lexical.readability_title':      'Readability over time',
            'lexical.readability_desc':       'Average Flesch reading-ease score, using its French adaptation, among scored articles published each year. Higher scores indicate language estimated to be easier to read from word and sentence length. The score does not measure the quality of an argument or readers’ actual understanding. Errors in text recognition can affect the results.',
            'lexical.richness_title':         'Vocabulary diversity over time',
            'lexical.richness_desc':          'Average vocabulary diversity among scored articles published each year. MATTR averages the proportion of different words in successive 50-word passages. Higher values indicate more varied vocabulary. Using a fixed passage length reduces the influence of article length; articles under 50 words are not scored. Errors in text recognition can affect the results.',
            'lexical.words_title':            'Article length over time',
            'lexical.words_desc':             'Average number of words per article published each year, counted from the scanned text.',
            'lexical.np_read_title':          'Newspapers by readability',
            'lexical.np_read_desc':           'The {top} newspapers with the highest average Flesch reading-ease scores, among those with at least {min} articles. Higher scores suggest easier reading based on word and sentence length. Only scored texts contribute to each average; text-recognition errors can affect the ranking.',
            'lexical.np_rich_title':          'Newspapers by vocabulary diversity',
            'lexical.np_rich_desc':           'The {top} newspapers with the highest average vocabulary diversity (MATTR), among those with at least {min} articles. MATTR measures the proportion of different words in successive 50-word passages. Higher values indicate more varied vocabulary; only scored texts contribute to each average.',
            'lexical.axis_readability':       'Flesch score',
            'lexical.axis_richness':          'MATTR'
        });
        ns.addTranslations('fr', {
            'Loading press language metrics': 'Chargement des indicateurs de langue',
            'lexical.mean_readability':       'Lisibilité moyenne (Flesch)',
            'lexical.mean_richness':          'Diversité moyenne du vocabulaire',
            'lexical.mean_words':             'Mots par article (moyenne)',
            'lexical.readability_title':      'Lisibilité au fil du temps',
            'lexical.readability_desc':       'Score moyen de lisibilité Flesch, dans son adaptation française, des articles évalués pour chaque année de publication. Un score élevé indique une langue estimée plus facile à lire d’après la longueur des mots et des phrases. Il ne mesure ni la qualité de l’argumentation ni la compréhension réelle des lecteurs. Les erreurs de reconnaissance du texte peuvent affecter les résultats.',
            'lexical.richness_title':         'Diversité du vocabulaire au fil du temps',
            'lexical.richness_desc':          'Diversité moyenne du vocabulaire des articles évalués pour chaque année de publication. Le MATTR est la proportion moyenne de mots différents dans des passages successifs de 50 mots. Une valeur élevée indique un vocabulaire plus varié. Une longueur de passage fixe réduit l’influence de la longueur de l’article ; les textes de moins de 50 mots ne sont pas évalués. Les erreurs de reconnaissance du texte peuvent affecter les résultats.',
            'lexical.words_title':            'Longueur des articles au fil du temps',
            'lexical.words_desc':             'Nombre moyen de mots par article publi\u00e9 chaque ann\u00e9e, compt\u00e9 \u00e0 partir du texte num\u00e9ris\u00e9.',
            'lexical.np_read_title':          'Journaux par lisibilité',
            'lexical.np_read_desc':           'Les {top} journaux aux scores moyens de lisibilité Flesch les plus élevés, parmi ceux comptant au moins {min} articles. Un score élevé suggère une lecture plus facile d’après la longueur des mots et des phrases. Seuls les textes évalués contribuent à chaque moyenne ; les erreurs de reconnaissance peuvent affecter le classement.',
            'lexical.np_rich_title':          'Journaux selon la diversité du vocabulaire',
            'lexical.np_rich_desc':           'Les {top} journaux à la diversité moyenne du vocabulaire (MATTR) la plus élevée, parmi ceux comptant au moins {min} articles. Le MATTR mesure la proportion de mots différents dans des passages successifs de 50 mots. Une valeur élevée indique un vocabulaire plus varié ; seuls les textes évalués contribuent à chaque moyenne.',
            'lexical.axis_readability':       'Score Flesch',
            'lexical.axis_richness':          'MATTR'
        });
})();
