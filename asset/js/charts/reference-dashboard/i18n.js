/**
 * IWAC Visualizations — reference dashboard block: translations.
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
        'desc_reference_activity':      'Where this work sits in the IWAC bibliography’s own publication timeline. The dot marks its year.',
        'desc_reference_similar':       'Works ranked by an AI comparison of their full texts. Only references with usable text representations can appear. These matches suggest reading leads; they do not establish that the works share an argument or cite one another.',
        'desc_reference_press':         'Newspaper articles ranked by an AI comparison with this work’s full text. Long texts are represented by averages of their passages, which can hide differences within a work. Check each match by reading it; similarity does not establish that the work discusses that article.',
        'reference_topic_label':        'Topic',
        'reference_topic_model':        'Machine-generated topic words, from the model “{model}”. Each language has its own model, so topic numbers are not comparable across them.',
        'reference_topic_generated':    'Machine-generated topic words, not curated subject headings.',
        'reference_reviews_prefix':     'Reviews:',
        'reference_reviewed_by_prefix': 'Reviewed in:',
    });

    ns.addTranslations('fr', {
        'This work in the bibliography': 'Ce travail dans la bibliographie',
        'Closest works in the bibliography': 'Travaux les plus proches dans la bibliographie',
        'Press coverage this resembles': 'Couverture de presse comparable',
        'desc_reference_activity':      'Position de ce travail dans la chronologie de publication de la bibliographie IWAC. Le point indique son ann\u00e9e.',
        'desc_reference_similar':       'Travaux classés par comparaison de leurs textes intégraux au moyen d’une IA. Seules les références disposant d’une représentation textuelle exploitable peuvent apparaître. Ces rapprochements donnent des pistes de lecture, sans établir que les travaux partagent un argument ou se citent.',
        'desc_reference_press':         'Articles de presse classés par comparaison avec le texte intégral de ce travail au moyen d’une IA. Les textes longs sont représentés par une moyenne de leurs passages, ce qui peut masquer des différences internes. Vérifiez chaque rapprochement par la lecture\u202f; la similarité n’établit pas que le travail traite de cet article.',
        'reference_topic_label':        'Th\u00e8me',
        'reference_topic_model':        'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, \u00e0 partir du mod\u00e8le \u00ab\u00a0{model}\u00a0\u00bb. Chaque langue a son propre mod\u00e8le\u00a0: les num\u00e9ros de th\u00e8mes ne sont pas comparables entre eux.',
        'reference_topic_generated':    'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, et non des vedettes-mati\u00e8re valid\u00e9es.',
        'reference_reviews_prefix':     'Compte rendu de\u00a0:',
        'reference_reviewed_by_prefix': 'Recens\u00e9 dans\u00a0:',
    });
})();
