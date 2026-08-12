/**
 * IWAC Visualizations — Semantic Landscape blocks: i18n strings.
 *
 * Split out of semantic-landscape.js (scary-terms pattern) so the
 * orchestrator carries logic, not a translation table. Serves BOTH blocks
 * that share the orchestrator — the article "Semantic landscape" and the
 * "Periodicals semantic landscape" — so both phtml templates load this
 * module in their `panels` list, before the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

        ns.addTranslations('en', {
            'Loading semantic landscape': 'Loading semantic landscape',
            'Semantic landscape': 'Semantic landscape',
            'desc_semantic_landscape': 'Every article in the collection, placed according to how similar its full text is to the others. An AI model compares the texts, and a technique called UMAP flattens those comparisons onto two dimensions, so the axes carry no meaning and only nearness does. Faint labels mark where each major topic is densest. Drag to move around the map, scroll to zoom, and click a point to open the article.',
            'Color by': 'Colour by',
            'Decade': 'Decade',
            'Topic': 'Topic',
            'Other': 'Other',
            'Unknown year': 'Unknown year',
            'landscape_points': '{count} articles placed',
            'Periodicals semantic landscape': 'Periodicals semantic landscape',
            'desc_periodicals_landscape': 'Every Islamic periodical issue in the collection, placed according to how similar its table of contents is to the others. An AI model compares the contents lists, and a technique called UMAP flattens those comparisons onto two dimensions, so the axes carry no meaning and only nearness does. Drag to move around the map, scroll to zoom, and click a point to open the issue.',
            'landscape_points_issues': '{count} issues placed'
        });
        ns.addTranslations('fr', {
            'Loading semantic landscape': 'Chargement du paysage sémantique',
            'Semantic landscape': 'Paysage sémantique',
            'desc_semantic_landscape': 'Chaque article de la collection, positionn\u00e9 selon la ressemblance de son texte int\u00e9gral avec celui des autres. Un mod\u00e8le d\u2019IA compare les textes, puis une technique appel\u00e9e UMAP ram\u00e8ne ces comparaisons \u00e0 deux dimensions ; les axes n\u2019ont donc pas de sens et seul compte le voisinage. Des libell\u00e9s discrets marquent la zone la plus dense de chaque grand th\u00e8me. Faites glisser pour vous d\u00e9placer sur la carte, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir l\u2019article.',
            'Color by': 'Colorer par',
            'Decade': 'Décennie',
            'Topic': 'Thème',
            'Other': 'Autre',
            'Unknown year': 'Année inconnue',
            'landscape_points': '{count} articles positionnés',
            'Periodicals semantic landscape': 'Paysage sémantique des périodiques',
            'desc_periodicals_landscape': 'Chaque num\u00e9ro de p\u00e9riodique islamique de la collection, positionn\u00e9 selon la ressemblance de son sommaire avec celui des autres. Un mod\u00e8le d\u2019IA compare les sommaires, puis une technique appel\u00e9e UMAP ram\u00e8ne ces comparaisons \u00e0 deux dimensions ; les axes n\u2019ont donc pas de sens et seul compte le voisinage. Faites glisser pour vous d\u00e9placer sur la carte, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir le num\u00e9ro.',
            'landscape_points_issues': '{count} numéros positionnés'
        });
})();
