/**
 * IWAC Visualizations — Collection Overview translations
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
        'source_locations_desc': 'Archives, repositories, web platforms and publication sources linked to collection items.',
        'source_map_summary': '{sources} sources · {mapped} mapped · {items} source-linked items',
    });

    ns.addTranslations('fr', {
        'Where the collection was gathered': 'Où la collection a été constituée',
        'Where the sources are published': 'Où les sources sont publiées',
        'Items per year, by country': '\u00c9l\u00e9ments par ann\u00e9e, par pays',
        'Most-cited entities': 'Entit\u00e9s les plus cit\u00e9es',
        'Newspaper coverage': 'Couverture des journaux',
        'Recent additions': 'Ajouts r\u00e9cents',
        'Collection growth over time': 'Croissance de la collection dans le temps',
        'Items by type, over time': '\u00c9l\u00e9ments par type, dans le temps',
        'French word cloud': 'Nuage de mots fran\u00e7ais',
        'World map': 'Carte du monde',
        'Source locations': 'Localisation des sources',
        'source_locations_desc': 'Archives, dépôts, plateformes web et sources de publication associés aux éléments de la collection.',
        'source_map_summary': '{sources} sources · {mapped} localisées · {items} éléments liés à une source',
        'No mapped sources': 'Aucune source localisée',
        'By type': 'Par type',
        'By year': 'Par ann\u00e9e',
        'Coordinates': 'Coordonnées',
        'Added': 'Ajout\u00e9',
        'No recent additions': 'Aucun ajout r\u00e9cent',
        'unique words': 'mots uniques',
    });
})();
