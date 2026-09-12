/**
 * IWAC Visualizations — Spatial Exploration translations
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
        'spatial_pick_hint':         'Choose a person, organisation, event, subject or place to map locations associated with the same records. Without a selection, the map shows the places available in the mapped data.',
        'places_count':              '{count} places',
        'spatial_map_description':   'Larger bubbles indicate places linked to more items through catalogue tags. Only places with known coordinates can be mapped. The map reflects the collection’s records, so an unmarked place may simply lack cataloguing or coordinates. Hover for a preview, or click a place for the item list.',
        'admin_units_count':         '{count} units',
        'more_items_click':          '{count} more \u2014 click for the full list',
    });

    ns.addTranslations('fr', {
        'Places mentioned in the collection': 'Lieux mentionnés dans la collection',
        'Pick an entity':            'Choisir une entit\u00e9',
        'spatial_pick_hint':         'Choisissez une personne, une organisation, un événement, un sujet ou un lieu pour situer les lieux associés aux mêmes notices. Sans sélection, la carte affiche les lieux disponibles dans les données cartographiques.',
        'places_count':              '{count} lieux',
        'View item page':            'Voir la fiche de l\u2019\u00e9l\u00e9ment',
        'Top places':                'Principaux lieux',
        'Map mode':                  'Mode de carte',
        'Place bubbles':             'Bulles de lieux',
        'Country choropleth':        'Choropl\u00e8the par pays',
        'Administrative choropleth': 'Choropl\u00e8the administrative',
        'Country focus':             'Focus pays',
        'Whole world':               'Monde entier',
        'Admin level':               'Niveau administratif',
        'Scale':                     '\u00c9chelle',
        'Quantile':                  'Quantile',
        'Linear':                    'Lin\u00e9aire',
        'Square root':               'Racine carr\u00e9e',
        'spatial_map_description':   'Les bulles les plus grandes indiquent les lieux associés à davantage de documents par les mots-clés du catalogue. Seuls les lieux aux coordonnées connues peuvent être cartographiés. La carte reflète les notices de la collection : un lieu absent peut simplement manquer d’indexation ou de coordonnées. Survolez un lieu pour un aperçu ou cliquez pour voir les documents.',
        'admin_units_count':         '{count} unit\u00e9s',
        'No administrative data':    'Aucune donn\u00e9e administrative',
        'No mapped places':          'Aucun lieu cartographi\u00e9',
        'more_items_click':          '{count} de plus \u2014 cliquer pour la liste compl\u00e8te',
    });
})();
