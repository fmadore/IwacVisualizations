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
        'networks_description':      'Each point represents a person, organisation, place, subject or event in the catalogue. Lines join entries recorded on the same items. The layout helps reveal groups of connections, but distances are approximate. Shared records do not by themselves establish a social relationship. Click a point to inspect its connections.',
        'network_select_hint':       'Click a point to see the entries sharing the most items with it; click the background to clear the selection.',
        'network_links_note':        'A line joins two entries recorded together on at least {count} items.',
        'cooccurrence_title':        'Co-occur in {count} items',
        'more_links_count':          '+{count} more links',
        'links_count':               '{count} links',
    });

    ns.addTranslations('fr', {
        'Entities': 'Entit\u00e9s',
        'Co-occurrence network':     'R\u00e9seau de cooccurrences',
        'networks_description':      'Chaque point représente une personne, une organisation, un lieu, un sujet ou un événement du catalogue. Les lignes relient les entrées associées aux mêmes documents. La disposition aide à repérer des groupes de liens, mais les distances sont approximatives. Des notices communes ne suffisent pas à établir une relation sociale. Cliquez sur un point pour examiner ses liens.',
        'About this network':        '\u00c0 propos de ce r\u00e9seau',
        'network_select_hint':       'Cliquez sur un point pour voir les entrées partageant le plus de documents avec lui ; cliquez sur le fond pour effacer la sélection.',
        'network_links_note':        'Une ligne relie deux entrées associées à au moins {count} documents communs.',
        'Strongest co-occurrences':  'Cooccurrences les plus fortes',
        'cooccurrence_title':        'Cooccurrence dans {count} \u00e9l\u00e9ments',
        'more_links_count':          '+{count} liens suppl\u00e9mentaires',
        'links_count':               '{count} liens',
        'Min. link strength':        'Force min. des liens',
        'All links':                 'Tous les liens',
        'Find in network':           'Chercher dans le r\u00e9seau',
    });
})();
