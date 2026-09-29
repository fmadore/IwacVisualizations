/**
 * IWAC Visualizations — minimal item dashboard block: translations.
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
        'desc_minimal_sparkline':            'Where this item sits in its collection’s activity over time. The dot marks the year of the current item.',
        'desc_minimal_similar':              'Other items in the same IWAC subset, most recent first. Click an item to open its page.',
        'desc_minimal_similar_semantic':     'Photographs ranked by an AI comparison of the images themselves. The model may identify visual or thematic similarities. The percentage is a similarity score, not the probability that the photographs show the same person, place or event.',
        'desc_minimal_sparkline_scoped':     'When this channel or collection published, year by year. The dot marks the year of the current item.',
        'desc_minimal_similar_scoped':       'Other recordings from the same channel or collection, most recent first. Click one to open its page.',
        'items_from_source':                 '{count} items from {source}',
        'hours_count':                       '{count} h',
        'minutes_count':                     '{count} min',
    });

    ns.addTranslations('fr', {
        'Visually similar photographs':      'Photographies visuellement similaires',
        'desc_minimal_sparkline':            'O\u00f9 cet \u00e9l\u00e9ment se situe dans la chronologie d\u2019activit\u00e9 de sa collection. Le point indique l\u2019ann\u00e9e de l\u2019\u00e9l\u00e9ment courant.',
        'desc_minimal_similar':              'Autres \u00e9l\u00e9ments du m\u00eame sous-ensemble IWAC, du plus r\u00e9cent au plus ancien. Cliquez sur un \u00e9l\u00e9ment pour ouvrir sa fiche.',
        'desc_minimal_similar_semantic':     'Photographies classées par comparaison des images elles-mêmes au moyen d’une IA. Le modèle peut relever des ressemblances visuelles ou thématiques. Le pourcentage est un score de similarité, et non la probabilité que les photographies montrent la même personne, le même lieu ou le même événement.',
        'desc_minimal_sparkline_scoped':     'Le rythme de publication de cette cha\u00eene ou de cette collection, ann\u00e9e par ann\u00e9e. Le point indique l\u2019ann\u00e9e de l\u2019\u00e9l\u00e9ment courant.',
        'desc_minimal_similar_scoped':       'Autres enregistrements de la m\u00eame cha\u00eene ou de la m\u00eame collection, du plus r\u00e9cent au plus ancien. Cliquez sur l\u2019un d\u2019eux pour ouvrir sa fiche.',
        'items_from_source':                 '{count} \u00e9l\u00e9ments de {source}',
        'hours_count':                       '{count} h',
        'minutes_count':                     '{count} min',
        'Videos':                            'Vid\u00e9os',
        'Median length':                     'Dur\u00e9e m\u00e9diane',
    });
})();
