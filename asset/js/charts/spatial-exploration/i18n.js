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
        'spatial_pick_hint':         'Pick an entity to map the places mentioned alongside it. Without a selection, the map shows every place in the collection.',
        'places_count':              '{count} places',
        'spatial_map_description':   'The larger the bubble, the more often the place is mentioned. Hover over a place for a preview, or click it for the full list of items.',
        'admin_units_count':         '{count} units',
        'more_items_click':          '{count} more \u2014 click for the full list',
    });

    ns.addTranslations('fr', {
        'Places mentioned in the collection': 'Lieux mentionnés dans la collection',
        'Pick an entity':            'Choisir une entit\u00e9',
        'spatial_pick_hint':         'Choisissez une entit\u00e9 pour cartographier les lieux mentionn\u00e9s \u00e0 ses c\u00f4t\u00e9s. Sans s\u00e9lection, la carte montre tous les lieux de la collection.',
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
        'spatial_map_description':   'Plus la bulle est grande, plus le lieu est souvent mentionn\u00e9. Survolez un lieu pour un aper\u00e7u ou cliquez dessus pour la liste compl\u00e8te des \u00e9l\u00e9ments.',
        'admin_units_count':         '{count} unit\u00e9s',
        'No administrative data':    'Aucune donn\u00e9e administrative',
        'No mapped places':          'Aucun lieu cartographi\u00e9',
        'more_items_click':          '{count} de plus \u2014 cliquer pour la liste compl\u00e8te',
    });
})();
