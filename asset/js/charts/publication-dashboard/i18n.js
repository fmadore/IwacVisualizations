/**
 * IWAC Visualizations — publication dashboard block: translations.
 *
 * Moved out of the shared dictionary (asset/js/iwac-i18n.js), which ships in
 * shared-core on every page carrying ANY block: these strings are read by this
 * block alone, so they now travel in its own bundle — built once per locale,
 * with the other locale's table emptied (scripts/i18n-strip.js).
 *
 * Registered at parse time, before the orchestrator loads.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) { return; }

    ns.addTranslations('en', {
        'desc_publication_run': 'Issues of this periodical per year. The dot marks this issue.',
        'desc_publication_similar': 'Issues ranked by an AI comparison of their tables of contents. The score reflects similarity between contents lists, which may hide differences within the articles themselves.',
        'desc_publication_wordcloud': 'The words that appear most often in this issue’s text.',
    });

    ns.addTranslations('fr', {
        'Issue': 'Numéro',
        'This issue in its periodical run': 'Ce numéro dans la collection du périodique',
        'desc_publication_run': 'Numéros de ce périodique par année. Le point marque ce numéro.',
        'Similar issues': 'Numéros similaires',
        'desc_publication_similar': 'Numéros classés par comparaison de leurs sommaires au moyen d’une IA. Le score reflète la similarité des sommaires, qui peut masquer des différences entre les articles eux-mêmes.',
        'Most frequent words in this issue': 'Mots les plus fréquents de ce numéro',
        'desc_publication_wordcloud': 'Les mots qui reviennent le plus souvent dans le texte de ce numéro.',
    });
})();
