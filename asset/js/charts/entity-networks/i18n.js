/**
 * IWAC Visualizations — Entity Networks translations
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
        'network_stats_entities':    '{nodes} entities · {links} links',
        'network_stats_places':      '{nodes} places · {links} links',
        'networks_description':      'Each point represents a person, organisation, place, subject or event in the catalogue. Lines join entries recorded on the same items. The layout helps reveal groups of connections, but distances are approximate. Shared records do not by themselves establish a social relationship. Click a point to inspect its connections.',
        'network_select_hint':       'Click a point to see the entries sharing the most items with it; click the background to clear the selection.',
        'network_links_note':        'A line joins two entries recorded together on at least {count} items.',
        'cooccurrence_title':        'Co-occur in {count} items',
        'cooccurrence_title_one':    'Co-occur in {count} item',
        'more_links_count':          '+{count} more links',
        'more_links_count_one':      '+{count} more link',
        'links_count':               '{count} links',
        'links_count_one':           '{count} link',
        'neighbourhood_title':       'Neighbourhood of {label}',
        'neighbourhood_caption':     '{label} and the {count} entries sharing the most items with it, as the network is filtered. Solid lines lead to {label}; dashed lines join two of these entries to each other. Drag a point to move it; click one for its links and its record.',
        'neighbourhood_caption_one': '{label} and the entry sharing the most items with it, as the network is filtered. Click it for its links and its record.',
        'neighbourhood_aria':        'Neighbourhood of {label}: the entries sharing the most items with it. Use the arrow keys to move between them and Enter to select one.',
    });

    ns.addTranslations('fr', {
        'network_stats_entities':    '{nodes} entités · {links} liens',
        'network_stats_places':      '{nodes} lieux · {links} liens',
        'Entities': 'Entit\u00e9s',
        'Co-occurrence network':     'R\u00e9seau de cooccurrences',
        'networks_description':      'Chaque point représente une personne, une organisation, un lieu, un sujet ou un événement du catalogue. Les lignes relient les entrées associées aux mêmes documents. La disposition aide à repérer des groupes de liens, mais les distances sont approximatives. Des notices communes ne suffisent pas à établir une relation sociale. Cliquez sur un point pour examiner ses liens.',
        'About this network':        '\u00c0 propos de ce r\u00e9seau',
        'network_select_hint':       'Cliquez sur un point pour voir les entrées partageant le plus de documents avec lui\u202f; cliquez sur le fond pour effacer la sélection.',
        'network_links_note':        'Une ligne relie deux entrées associées à au moins {count} documents communs.',
        'Strongest co-occurrences':  'Cooccurrences les plus fortes',
        'cooccurrence_title':        'Cooccurrence dans {count} documents',
        'cooccurrence_title_one':    'Cooccurrence dans {count} document',
        'more_links_count':          '+{count} liens suppl\u00e9mentaires',
        'more_links_count_one':      '+{count} lien suppl\u00e9mentaire',
        'links_count':               '{count} liens',
        'links_count_one':           '{count} lien',
        'Explore its neighbourhood': 'Explorer son voisinage',
        'Back to the full network':  'Revenir au réseau complet',
        'Shared items':              'Documents communs',
        'neighbourhood_title':       'Voisinage de {label}',
        'neighbourhood_caption':     '{label} et les {count} entrées qui partagent le plus de documents avec elle, selon les filtres du réseau. Les lignes pleines mènent à {label} ; les pointillés relient deux de ces entrées entre elles. Faites glisser un point pour le déplacer ; cliquez dessus pour voir ses liens et sa notice.',
        'neighbourhood_caption_one': '{label} et l’entrée qui partage le plus de documents avec elle, selon les filtres du réseau. Cliquez dessus pour voir ses liens et sa notice.',
        'neighbourhood_aria':        'Voisinage de {label} : les entrées qui partagent le plus de documents avec elle. Utilisez les flèches pour passer de l’une à l’autre et Entrée pour en sélectionner une.',
        'Min. link strength':        'Force min. des liens',
        'All links':                 'Tous les liens',
        'Find in network':           'Chercher dans le r\u00e9seau',
        'Network of entries recorded on the same items':
            'R\u00e9seau des entr\u00e9es associ\u00e9es aux m\u00eames documents',
        'Network of places recorded on the same items':
            'R\u00e9seau des lieux associ\u00e9s aux m\u00eames documents',
        'Entry':                     'Entr\u00e9e',
        'Links':                     'Liens',
    });
})();
