/**
 * IWAC Visualizations — Publication Dashboard translations
 *
 * Strings only this block renders. They used to sit in the shared
 * `iwac-i18n.js`, which every block page loads whole — so a block-only
 * string there was bytes every OTHER page paid for and never used (S24).
 *
 * `check-i18n.js` proves the split is correct rather than assuming it: it
 * walks every `t('literal')` in each bundle and fails when a key is not
 * reachable from the shared dictionary plus the dictionaries that bundle
 * carries. Load order matters — this file is FIRST in the block's bundle,
 * so the strings exist before any panel asks for one.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) return;

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
