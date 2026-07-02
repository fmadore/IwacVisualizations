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
            'desc_semantic_landscape': 'Every article in the collection, placed by the semantic similarity of its full text (UMAP projection of AI text embeddings — axes have no meaning, only proximity does). Drag to pan, scroll to zoom, click a point to open the article.',
            'Color by': 'Color by',
            'Decade': 'Decade',
            'Topic': 'Topic',
            'Other': 'Other',
            'Unknown year': 'Unknown year',
            'landscape_points': '{count} articles placed',
            'Periodicals semantic landscape': 'Periodicals semantic landscape',
            'desc_periodicals_landscape': 'Every Islamic-periodical issue in the collection, placed by the semantic similarity of its table of contents (UMAP projection of AI text embeddings — axes have no meaning, only proximity does). Drag to pan, scroll to zoom, click a point to open the issue.',
            'landscape_points_issues': '{count} issues placed'
        });
        ns.addTranslations('fr', {
            'Loading semantic landscape': 'Chargement du paysage sémantique',
            'Semantic landscape': 'Paysage sémantique',
            'desc_semantic_landscape': 'Chaque article de la collection, positionné selon la similarité sémantique de son texte intégral (projection UMAP des plongements de texte IA — les axes n’ont pas de sens, seule la proximité compte). Glissez pour déplacer, molette pour zoomer, cliquez sur un point pour ouvrir l’article.',
            'Color by': 'Colorer par',
            'Decade': 'Décennie',
            'Topic': 'Thème',
            'Other': 'Autre',
            'Unknown year': 'Année inconnue',
            'landscape_points': '{count} articles positionnés',
            'Periodicals semantic landscape': 'Paysage sémantique des périodiques',
            'desc_periodicals_landscape': 'Chaque numéro de périodique islamique de la collection, positionné selon la similarité sémantique de sa table des matières (projection UMAP des plongements de texte IA — les axes n’ont pas de sens, seule la proximité compte). Glissez pour déplacer, molette pour zoomer, cliquez sur un point pour ouvrir le numéro.',
            'landscape_points_issues': '{count} numéros positionnés'
        });
})();
