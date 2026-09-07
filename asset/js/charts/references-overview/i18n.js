/**
 * IWAC Visualizations — References Overview translations
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
        'references_provenance_desc': 'Places of publication recorded on the references, shown wherever the place could be matched to map coordinates.',
        'references_subject_cooccurrence_desc': 'Pairs of subject tags that appear together on the same reference.',
        'Full-text coverage': 'Full-text coverage',
        'references_coverage_desc': 'How many references have their full text available as searchable text, by kind of publication.',
        'references_coverage_desc_full': 'Full text has been extracted for {withOcr} of {total} references ({pct}%): {words} words in all, and {median} in a typical reference. The topic panels below describe that digitised part of the bibliography rather than the whole of it. Each bar shows the digitised count for one kind of publication against its total. Of these references, {published} also have their text published on islam.zmo.de; the others feed the aggregate figures here without being readable in full.',
        'references_coverage_tooltip': '{withOcr} of {total} with full text ({pct}%)',
        'Semantic landscape of the literature': 'Semantic landscape of the literature',
        'references_landscape_desc': 'Each point is one reference, placed according to how similar its full text is to the others. Works sitting close together are ones the AI model reads as being about the same thing. Drag to move around the map, scroll to zoom, and click a point to open the reference.',
        'references_landscape_desc_full': 'Each point is one reference, placed according to how similar its full text is to the others: an AI model compares the texts, and a technique called UMAP flattens those comparisons onto two dimensions. Works sitting close together are ones the model reads as being about the same thing. The axes have no units, and the distance between two clusters means nothing; only which points sit near which. The map covers the {embedded} of {total} references ({pct}%) whose full text has been extracted, and that subset reflects what the collection was able to obtain and digitise rather than a representative sample. Drag to move around the map, scroll to zoom, and click a point to open the reference.',
        'Scholarly topics': 'Scholarly topics',
        'references_topics_title_lang': 'Scholarly topics ({language})',
        'references_topics_desc': 'Themes found automatically in the full text of {count} references by a statistical model (LDA), which sorted them into {topics} topics. Each label lists the words most characteristic of its topic; the labels come from the model rather than from a cataloguer. Each language has its own model, so topic numbers cannot be compared between these panels. Hover over a bar for the references most typical of that topic.',
        'references_topic_tooltip': '{count} references ({pct}% of this model’s corpus). Most representative:',
    });

    ns.addTranslations('fr', {
        'Where the scholarship was published': 'Où les travaux scientifiques ont été publiés',
        'Reference types': 'Types de r\u00e9f\u00e9rence',
        'References by type over time': 'R\u00e9f\u00e9rences par type dans le temps',
        'Top authors': 'Auteurs les plus cit\u00e9s',
        'Top publishers': '\u00c9diteurs les plus cit\u00e9s',
        'Reference provenance': 'Provenance des r\u00e9f\u00e9rences',
        'references_provenance_desc': 'Lieux de publication indiqu\u00e9s sur les r\u00e9f\u00e9rences, affich\u00e9s lorsque le lieu a pu \u00eatre associ\u00e9 \u00e0 des coordonn\u00e9es cartographiques.',
        'references_subject_cooccurrence_desc': 'Paires de sujets apparaissant ensemble sur une m\u00eame r\u00e9f\u00e9rence.',
        'Full-text coverage': 'Couverture en texte intégral',
        'references_coverage_desc': 'Nombre de références dont le texte intégral est disponible sous forme de texte interrogeable, par type de publication.',
        'references_coverage_desc_full': 'Le texte intégral a été extrait pour {withOcr} références sur {total} ({pct} %), soit {words} mots au total et {median} pour une référence typique. Les panneaux de thèmes ci-dessous décrivent cette partie numérisée de la bibliographie plutôt que son ensemble. Chaque barre indique le nombre de références numérisées pour un type de publication, rapporté à son total. Parmi ces références, {published} ont aussi leur texte publié sur islam.zmo.de ; les autres alimentent les chiffres agrégés présentés ici sans être consultables intégralement.',
        'references_coverage_tooltip': '{withOcr} sur {total} avec texte intégral ({pct} %)',
        'Semantic landscape of the literature': 'Paysage sémantique de la littérature scientifique',
        'references_landscape_desc': 'Chaque point est une référence, positionnée selon la ressemblance de son texte intégral avec celui des autres. Les travaux qui se retrouvent voisins sont ceux que le modèle d’IA lit comme portant sur le même objet. Faites glisser pour vous déplacer sur la carte, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir la référence.',
        'references_landscape_desc_full': 'Chaque point est une référence, positionnée selon la ressemblance de son texte intégral avec celui des autres. Un modèle d’IA compare les textes, puis une technique appelée UMAP ramène ces comparaisons à deux dimensions. Les travaux qui se retrouvent voisins sont ceux que le modèle lit comme portant sur le même objet. Les axes n’ont pas d’unité et la distance entre deux grappes ne signifie rien ; seul compte le voisinage. La carte couvre les {embedded} références sur {total} ({pct} %) dont le texte intégral a été extrait, un sous-ensemble qui reflète ce que la collection a pu obtenir et numériser plutôt qu’un échantillon représentatif. Faites glisser pour vous déplacer sur la carte, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir la référence.',
        'Scholarly topics': 'Thèmes de la littérature scientifique',
        'references_topics_title_lang': 'Thèmes de la littérature scientifique ({language})',
        'references_topics_desc': 'Thèmes dégagés automatiquement dans le texte intégral de {count} références par un modèle statistique (LDA), qui les a réparties en {topics} thèmes. Chaque libellé reprend les mots les plus caractéristiques de son thème ; ces libellés viennent du modèle plutôt que d’un catalogueur. Chaque langue a son propre modèle, si bien que les numéros de thèmes ne sont pas comparables d’un panneau à l’autre. Survolez une barre pour voir les références les plus représentatives du thème.',
        'references_topic_tooltip': '{count} références ({pct} % du corpus de ce modèle). Les plus représentatives :',
        'Author collaborations': 'Collaborations entre auteurs',
    });
})();
