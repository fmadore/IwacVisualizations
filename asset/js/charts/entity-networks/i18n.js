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
        'networks_description':      'Entities that appear in the same items, placed closer together the more often they are mentioned together. Click a node to see its connections.',
        'network_select_hint':       'Click a node to see its strongest co-occurrences; click the background to clear.',
        'network_links_note':        'A link joins two entities that appear in the same item at least {count} times.',
        'cooccurrence_title':        'Co-occur in {count} items',
        'more_links_count':          '+{count} more links',
        'links_count':               '{count} links',
    });

    ns.addTranslations('fr', {
        'Entities': 'Entit\u00e9s',
        'Co-occurrence network':     'R\u00e9seau de cooccurrences',
        'networks_description':      'Les entit\u00e9s qui apparaissent dans les m\u00eames \u00e9l\u00e9ments, d\u2019autant plus proches qu\u2019elles sont souvent mentionn\u00e9es ensemble. Cliquez sur un n\u0153ud pour voir ses liens.',
        'About this network':        '\u00c0 propos de ce r\u00e9seau',
        'network_select_hint':       'Cliquez sur un n\u0153ud pour voir ses cooccurrences les plus fortes\u202f; cliquez sur le fond pour effacer.',
        'network_links_note':        'Un lien relie deux entit\u00e9s qui apparaissent dans le m\u00eame \u00e9l\u00e9ment au moins {count} fois.',
        'Strongest co-occurrences':  'Cooccurrences les plus fortes',
        'cooccurrence_title':        'Cooccurrence dans {count} \u00e9l\u00e9ments',
        'more_links_count':          '+{count} liens suppl\u00e9mentaires',
        'links_count':               '{count} liens',
        'Min. link strength':        'Force min. des liens',
        'All links':                 'Tous les liens',
        'Find in network':           'Chercher dans le r\u00e9seau',
    });
})();
