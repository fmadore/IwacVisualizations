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
            'Reference provenance': 'Places of publication',
            'references.network_desc': 'Lines connect co-authors, or authors and editors, credited on the same references. More shared references produce stronger links. This network records bibliographic relationships, not all professional or personal connections.',
            'references.breakdown_desc': 'References grouped by associated country and publication type. Rectangle size indicates the number of references. A work associated with several countries can appear in more than one group.',
            'references.subjects_desc': 'The most frequent subject tags assigned to references. A reference can have several tags; the ranking describes the catalogue’s indexing.',
            'references.publishers_desc': 'Publishers ranked by the number of references recorded in the selected group. Missing or variant publisher names can affect the ranking.',
            'references.authors_desc': 'Authors ranked by the number of works recorded in this bibliography. Counts reflect the collection’s coverage, not citation counts or an author’s complete output.',
            'references.countries_desc': 'Countries associated with the references in the catalogue. A work may be associated with several countries; these associations differ from its place of publication.',
            'references.languages_desc': 'Languages in which the works are written, as recorded in the catalogue. A reference can list several languages.',
            'references.types_desc': 'Number of references of each publication type, as recorded in the catalogue.',
            'references.timeline_desc': 'Bibliographic works by publication year and type. Dates refer to the works themselves, not the historical periods they study. The chart reflects the bibliography assembled in IWAC.',
        'references_provenance_desc': 'Places of publication recorded on the references, shown wherever the place could be matched to map coordinates.',
        'references_subject_cooccurrence_desc': 'Pairs of subject tags that appear together on the same reference.',
        'Full-text coverage': 'Full-text coverage',
        'references_coverage_desc': 'How many references have their full text available as searchable text, by kind of publication.',
        'references_coverage_desc_full': 'Full text has been extracted for {withOcr} of {total} references ({pct}%): {words} words in all, and {median} in a typical reference. The topic panels below describe that digitised part of the bibliography rather than the whole of it. Each bar shows the digitised count for one kind of publication against its total. Of these references, {published} also have their text published on islam.zmo.de; the others feed the aggregate figures here without being readable in full.',
        'references_coverage_tooltip': '{withOcr} of {total} with full text ({pct}%)',
        'Semantic landscape of the literature': 'Scholarly works by text similarity',
        'references_landscape_desc': 'Each point is a reference with a usable AI representation of its full text. Nearby points suggest works with similar content. The two-dimensional layout is approximate, so read the works to assess their relationship. Drag to move, scroll to zoom, and click a point to open the reference.',
        'references_landscape_desc_full': 'The map includes {embedded} of {total} references ({pct}%) with usable AI representations of their full texts. UMAP arranges these representations in two dimensions to bring broadly similar texts together. Local neighbourhoods suggest works to compare; distances between groups and the axes have no precise interpretive scale. Coverage reflects the works obtained and digitised. Drag to move, scroll to zoom, and click a point to open the reference.',
        'Scholarly topics': 'Scholarly topics',
        'references_topics_title_lang': 'Scholarly topics ({language})',
        'references_topics_desc': 'Themes found automatically in the full text of {count} references by a statistical model (LDA), which sorted them into {topics} topics. Each label lists the words most characteristic of its topic; the labels come from the model rather than from a cataloguer. Each language has its own model, so topic numbers cannot be compared between these panels. Hover over a bar for the references most typical of that topic.',
        'references_topic_tooltip': '{count} references ({pct}% of this model’s corpus). Most representative:',
    });

    ns.addTranslations('fr', {
            'references.network_desc': 'Les lignes relient les coauteurs, ou les auteurs et éditeurs, crédités sur les mêmes références. Plus les références communes sont nombreuses, plus les liens sont forts. Ce réseau décrit des relations bibliographiques, sans couvrir tous les liens professionnels ou personnels.',
            'references.breakdown_desc': 'Références regroupées par pays associé et par type de publication. La taille des rectangles indique leur nombre. Un travail associé à plusieurs pays peut apparaître dans plusieurs groupes.',
            'references.subjects_desc': 'Mots-clés de sujets les plus fréquents dans les références. Une référence peut porter plusieurs mots-clés ; le classement décrit l’indexation du catalogue.',
            'references.publishers_desc': 'Éditeurs classés selon le nombre de références enregistrées dans le groupe sélectionné. Les noms manquants ou les variantes peuvent affecter le classement.',
            'references.authors_desc': 'Auteurs classés selon le nombre de travaux enregistrés dans cette bibliographie. Ces nombres reflètent la couverture de la collection, sans mesurer les citations ou toute la production d’un auteur.',
            'references.countries_desc': 'Pays associés aux références dans le catalogue. Un travail peut être associé à plusieurs pays ; ces associations diffèrent de son lieu de publication.',
            'references.languages_desc': 'Langues de rédaction des travaux, selon les notices du catalogue. Une référence peut indiquer plusieurs langues.',
            'references.types_desc': 'Nombre de références par type de publication, selon les notices du catalogue.',
            'references.timeline_desc': 'Travaux bibliographiques par année de publication et par type. Les dates concernent les travaux eux-mêmes, et non les périodes historiques étudiées. Le graphique reflète la bibliographie réunie dans IWAC.',
        'Where the scholarship was published': 'Où les travaux scientifiques ont été publiés',
        'Reference types': 'Types de r\u00e9f\u00e9rence',
        'References by type over time': 'R\u00e9f\u00e9rences par type dans le temps',
        'Top authors': 'Auteurs les plus cit\u00e9s',
        'Top publishers': '\u00c9diteurs les plus cit\u00e9s',
        'Reference provenance': 'Lieux de publication',
        'references_provenance_desc': 'Lieux de publication indiqu\u00e9s sur les r\u00e9f\u00e9rences, affich\u00e9s lorsque le lieu a pu \u00eatre associ\u00e9 \u00e0 des coordonn\u00e9es cartographiques.',
        'references_subject_cooccurrence_desc': 'Paires de sujets apparaissant ensemble sur une m\u00eame r\u00e9f\u00e9rence.',
        'Full-text coverage': 'Couverture en texte intégral',
        'references_coverage_desc': 'Nombre de références dont le texte intégral est disponible sous forme de texte interrogeable, par type de publication.',
        'references_coverage_desc_full': 'Le texte intégral a été extrait pour {withOcr} références sur {total} ({pct} %), soit {words} mots au total et {median} pour une référence typique. Les panneaux de thèmes ci-dessous décrivent cette partie numérisée de la bibliographie plutôt que son ensemble. Chaque barre indique le nombre de références numérisées pour un type de publication, rapporté à son total. Parmi ces références, {published} ont aussi leur texte publié sur islam.zmo.de ; les autres alimentent les chiffres agrégés présentés ici sans être consultables intégralement.',
        'references_coverage_tooltip': '{withOcr} sur {total} avec texte intégral ({pct} %)',
        'Semantic landscape of the literature': 'Travaux scientifiques selon leur similarité textuelle',
        'references_landscape_desc': 'Chaque point correspond à une référence dont le texte intégral dispose d’une représentation exploitable produite par IA. Les points voisins suggèrent des travaux aux contenus proches. La disposition en deux dimensions est approximative : la lecture permet d’évaluer leur relation. Faites glisser pour vous déplacer, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir la référence.',
        'references_landscape_desc_full': 'La carte comprend {embedded} références sur {total} ({pct} %) dont le texte intégral dispose d’une représentation exploitable produite par IA. La méthode UMAP les dispose en deux dimensions pour rapprocher les textes globalement similaires. Les voisinages suggèrent des travaux à comparer ; les distances entre groupes et les axes n’ont pas d’échelle d’interprétation précise. La couverture reflète les travaux obtenus et numérisés. Faites glisser pour vous déplacer, utilisez la molette pour zoomer et cliquez sur un point pour ouvrir la référence.',
        'Scholarly topics': 'Thèmes de la littérature scientifique',
        'references_topics_title_lang': 'Thèmes de la littérature scientifique ({language})',
        'references_topics_desc': 'Thèmes dégagés automatiquement dans le texte intégral de {count} références par un modèle statistique (LDA), qui les a réparties en {topics} thèmes. Chaque libellé reprend les mots les plus caractéristiques de son thème ; ces libellés viennent du modèle plutôt que d’un catalogueur. Chaque langue a son propre modèle, si bien que les numéros de thèmes ne sont pas comparables d’un panneau à l’autre. Survolez une barre pour voir les références les plus représentatives du thème.',
        'references_topic_tooltip': '{count} références ({pct} % du corpus de ce modèle). Les plus représentatives :',
        'Author collaborations': 'Collaborations entre auteurs',
    });
})();
