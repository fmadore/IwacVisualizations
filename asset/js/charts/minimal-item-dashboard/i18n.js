/**
 * IWAC Visualizations — Minimal Item Dashboard translations
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
        'desc_minimal_sparkline':            'Where this item sits in its collection’s activity over time. The dot marks the year of the current item.',
        'desc_minimal_similar':              'Other items in the same IWAC subset, most recent first. Click an item to open its page.',
        'desc_minimal_similar_semantic':     'Photographs ranked by an AI comparison of the images themselves. The model may identify visual or thematic similarities. The percentage is a similarity score, not the probability that the photographs show the same person, place or event.',
        'desc_minimal_sparkline_scoped':     'When this channel or collection published, year by year. The dot marks the year of the current item.',
        'desc_minimal_similar_scoped':       'Other recordings from the same channel or collection, most recent first. Click one to open its page.',
        'items_from_source':                 '{count} items from {source}',
        'items_from_source_one':             '{count} item from {source}',
    });

    ns.addTranslations('fr', {
        'Activity over time':                'Activit\u00e9 dans le temps',
        'Other items in this collection':    'Autres documents de cette collection',
        'Visually similar photographs':      'Photographies visuellement similaires',
        'desc_minimal_sparkline':            'Où ce document se situe dans la chronologie d’activité de sa collection. Le point indique l’année du document courant.',
        'desc_minimal_similar':              'Autres documents du même sous-ensemble IWAC, du plus récent au plus ancien. Cliquez sur un document pour ouvrir sa fiche.',
        'desc_minimal_similar_semantic':     'Photographies classées par comparaison des images elles-mêmes au moyen d’une IA. Le modèle peut relever des ressemblances visuelles ou thématiques. Le pourcentage est un score de similarité, et non la probabilité que les photographies montrent la même personne, le même lieu ou le même événement.',
        'Activity of this source over time': 'Activit\u00e9 de cette source dans le temps',
        'More from this source':             'Autres contenus de cette source',
        'desc_minimal_sparkline_scoped':     'Le rythme de publication de cette chaîne ou de cette collection, année par année. Le point indique l’année du document courant.',
        'desc_minimal_similar_scoped':       'Autres enregistrements de la m\u00eame cha\u00eene ou de la m\u00eame collection, du plus r\u00e9cent au plus ancien. Cliquez sur l\u2019un d\u2019eux pour ouvrir sa fiche.',
        'items_from_source':                 '{count} documents de {source}',
        'items_from_source_one':             '{count} document de {source}',
        'Videos':                            'Vid\u00e9os',
        'Total runtime':                     'Dur\u00e9e totale',
        'Median length':                     'Dur\u00e9e m\u00e9diane',
        'Watch on YouTube':                  'Regarder sur YouTube',
    });
})();
