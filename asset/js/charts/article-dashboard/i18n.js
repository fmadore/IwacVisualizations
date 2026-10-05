/**
 * IWAC Visualizations — article dashboard block: translations.
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
        'Context network': 'This article’s catalogue connections',
        'desc_article_context_network':
            'This article sits at the centre, surrounded by the people, places, organisations and subjects tagged in it. Articles that share several of those tags appear around the edge. Drag a node to rearrange the graph, or click one to see its connections and a link to its page.',
        'desc_article_further_reading':
            'Other material from the collection that connects to this article. Use the tabs to switch between the ways of finding it.',
        'desc_further_reading_tags':
            'Articles tagged with the same people, places, organisations or subjects as this one. The badge shows how many tags they share.',
        'desc_further_reading_scholarship':
            'Scholarly works suggested by an AI comparison of their full texts with this article. Long works are represented by averages of their passages, so a match can reflect broad subject matter. Check the work before using it as a reference; the match does not establish that it discusses this article.',
        'desc_further_reading_content':
            'Articles ranked by an AI comparison of their full texts, including articles with no shared catalogue tags. The badge gives a similarity score expressed as a percentage, not the probability of a correct match. Read the articles to assess what they have in common.',
        'shares_n_entities':       '{count} shared tags',
        'No related articles':     'No articles with shared tags',
        'No entities tagged':      'No entities tagged on this article',
        'desc_article_spatial':         'Places recorded in this article’s catalogue tags and located through the IWAC place index. Each pin marks one tagged place; equal pin sizes do not indicate how often a place is named in the text. Click a pin to open its record.',
        'article_place_subtitle':       'Mentioned in this article',
        'No geocoded places':           'No places on this article could be located',
        'shares_n_entities_one':   '{count} shared tag',
    });

    ns.addTranslations('fr', {
        'Network of the entities this article is tagged with and the articles sharing them. Use the arrow keys to move between them and Enter to select one.':
            'R\u00e9seau des entit\u00e9s balis\u00e9es dans cet article et des articles qui les partagent. Utilisez les fl\u00e8ches pour circuler entre elles et Entr\u00e9e pour en s\u00e9lectionner une.',
        'Context network': 'Liens de cet article dans le catalogue',
        'Further reading':         'Pour aller plus loin',
        'desc_article_context_network':
            'Cet article est au centre, entour\u00e9 des personnes, lieux, organisations et sujets qui y sont balis\u00e9s. Les articles qui partagent plusieurs de ces balises apparaissent en p\u00e9riph\u00e9rie. Faites glisser un n\u0153ud pour r\u00e9organiser le graphe ou cliquez dessus pour voir ses liens et acc\u00e9der \u00e0 sa fiche.',
        'desc_article_further_reading':
            'D\u2019autres documents de la collection qui se rattachent \u00e0 cet article. Les onglets permettent de changer de mani\u00e8re de les trouver.',
        'desc_further_reading_tags':
            'Articles balis\u00e9s avec les m\u00eames personnes, lieux, organisations ou sujets que celui-ci. Le badge indique combien de balises ils ont en commun.',
        'desc_further_reading_scholarship':
            'Travaux scientifiques suggérés par comparaison de leurs textes intégraux avec cet article au moyen d’une IA. Les textes longs sont représentés par une moyenne de leurs passages ; un rapprochement peut donc refléter un sujet général. Examinez le travail avant de le citer ; le rapprochement n’établit pas qu’il traite de cet article.',
        'desc_further_reading_content':
            'Articles classés par comparaison de leurs textes intégraux au moyen d’une IA, y compris sans mots-clés communs dans le catalogue. Le badge indique un score de similarité exprimé en pourcentage, et non la probabilité d’un rapprochement correct. Lisez les articles pour évaluer leurs points communs.',
        'Shares':                  'Partage',
        'shares_n_entities':       '{count} balises partag\u00e9es',
        'No related articles':     'Aucun article avec des balises communes',
        'No further reading found':'Aucun autre article \u00e0 sugg\u00e9rer',
        'No entities tagged':      'Aucune entit\u00e9 associ\u00e9e \u00e0 cet article',
        'By shared tags':          'Par balises communes',
        'By similar content':      'Par contenu similaire',
        'In the scholarship':      'Dans la littérature',
        'No related scholarship':  'Aucun travail scientifique proche',
        'desc_article_spatial':         'Lieux indiqués dans les mots-clés de la notice de cet article et localisés grâce à l’index IWAC. Chaque repère correspond à un lieu indexé ; leur taille identique n’indique pas sa fréquence dans le texte. Cliquez sur un repère pour ouvrir sa notice.',
        'article_place_subtitle':       'Mentionn\u00e9 dans cet article',
        'No geocoded places':           'Aucun lieu de cet article n\u2019a pu \u00eatre localis\u00e9',
        'shares_n_entities_one':   '{count} balise partagée',
    });
})();
