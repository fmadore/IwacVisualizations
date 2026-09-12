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
            'Semantic landscape': 'Articles by text similarity',
            'desc_semantic_landscape': 'Each point is an article with a usable AI representation of its full text. UMAP, a method for arranging these representations in two dimensions, places broadly similar texts near one another. Nearby points are leads for comparison; distances and gaps are not precise measures of similarity. The axes have no historical or geographical meaning. Labels indicate concentrations of major topics. Drag to move, scroll to zoom, and click a point to open the article.',
            'Topic': 'Topic',
            'Other': 'Other',
            'Unknown year': 'Unknown year',
            'landscape_points': '{count} articles placed',
            'Periodicals semantic landscape': 'Periodical issues by contents-list similarity',
            'desc_periodicals_landscape': 'Each point is a periodical issue with a usable AI representation of its table of contents. UMAP arranges these representations in two dimensions to bring broadly similar contents lists together. Nearby points suggest issues to compare; distances are approximate and the axes have no historical or geographical meaning. The comparison uses contents lists, so it may miss differences within the articles themselves. Drag to move, scroll to zoom, and click a point to open the issue.',
            'landscape_points_issues': '{count} issues placed'
        });
        ns.addTranslations('fr', {
            'Loading semantic landscape': 'Chargement du paysage sémantique',
            'Semantic landscape': 'Articles selon leur similarité textuelle',
            'desc_semantic_landscape': 'Chaque point correspond à un article dont le texte intégral dispose d’une représentation exploitable produite par IA. La méthode UMAP dispose ces représentations en deux dimensions et rapproche les textes globalement similaires. Les voisinages donnent des pistes de comparaison ; les distances et les espaces vides ne mesurent pas précisément la similarité. Les axes n’ont aucun sens historique ou géographique. Les libellés situent les concentrations des principaux thèmes. Faites glisser pour vous déplacer, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir l’article.',
            'Unknown year': 'Année inconnue',
            'landscape_points': '{count} articles positionnés',
            'Periodicals semantic landscape': 'Numéros de périodiques selon la similarité des sommaires',
            'desc_periodicals_landscape': 'Chaque point correspond à un numéro de périodique dont le sommaire dispose d’une représentation exploitable produite par IA. La méthode UMAP dispose ces représentations en deux dimensions pour rapprocher les sommaires globalement similaires. Les voisinages suggèrent des numéros à comparer ; les distances sont approximatives et les axes n’ont aucun sens historique ou géographique. La comparaison repose sur les sommaires et peut donc masquer des différences entre les articles eux-mêmes. Faites glisser pour vous déplacer, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir le numéro.',
            'landscape_points_issues': '{count} numéros positionnés'
        });
})();
