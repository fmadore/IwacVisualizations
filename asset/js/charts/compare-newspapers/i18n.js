/**
 * IWAC Visualizations — compare newspapers block: translations.
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
        'No overlap': 'No shared tags in these lists',
        'Spatial coverage overlap': 'Places shared by the selections',
        'Subject overlap': 'Subjects shared by the selections',
        'compare.overlap_desc': 'Tags found in both selections or in only one of the supplied tag lists. Each column shows its most frequent entries; shared counts are listed in A / B order. The source lists are limited, so absence from a list does not establish absence from the full selection.',
        'compare.newspapers_desc': 'Number of collected items per newspaper or periodical in each selection. This describes IWAC holdings, not the publication’s total production.',
        'compare.words_desc': 'Frequent words in the available text of each selection, after common grammatical words are removed. Word sizes are scaled separately in each cloud; use the counts to compare frequencies.',
        'compare.subjects_desc': 'The 15 catalogue subjects with the highest combined counts across both selections. Bars count tagged items, not repeated words. Larger selections can produce larger counts without giving a subject a greater share of their coverage.',
        'compare.timeline_desc': 'Items in each selection by publication year. These are counts, so the size and date coverage of each selection affect the comparison. An article and a periodical issue are different units.',
        'Only in A':                     'Only in {name}',
        'Only in B':                     'Only in {name}',
        'Sentiment only on articles':    'Sentiment ratings cover articles only',
        'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
            'Places mentioned in each corpus, matched against the IWAC authority index. The larger the bubble, the more items tagged that place.',
        'Distribution of polarity and centrality in articles of each corpus, as rated by the AI models. The picker swaps the model; publications are not rated.':
            'How polarity and centrality are distributed across the articles of each corpus, as rated by the AI models. Use the picker to change model; publications are not rated.',
        'Diverging A minus B':          'Difference: A minus B',
    });

    ns.addTranslations('fr', {
        'compare.overlap_desc': 'Mots-clés présents dans les deux sélections ou dans une seule des listes fournies. Chaque colonne montre ses entrées les plus fréquentes ; les nombres communs sont indiqués dans l’ordre A / B. Les listes sources sont limitées : l’absence d’un mot-clé dans une liste n’établit pas son absence de la sélection entière.',
        'compare.newspapers_desc': 'Nombre de documents collectés par journal ou périodique dans chaque sélection. Cette vue décrit les collections IWAC, et non toute la production d’un titre.',
        'compare.words_desc': 'Mots fréquents dans le texte disponible de chaque sélection, après retrait des mots grammaticaux courants. La taille des mots est ajustée séparément dans chaque nuage ; utilisez les nombres pour comparer les fréquences.',
        'compare.subjects_desc': 'Les 15 sujets du catalogue aux nombres cumulés les plus élevés dans les deux sélections. Les barres comptent les documents indexés, et non les répétitions de mots. Une sélection plus grande peut produire des nombres plus élevés sans consacrer une part supérieure de sa couverture à un sujet.',
        'compare.timeline_desc': 'Documents de chaque sélection par année de publication. Il s’agit de nombres : le volume et la période couverte par chaque sélection affectent la comparaison. Un article et un numéro de périodique constituent des unités différentes.',
        'Corpus A':                      'Corpus A',
        'Corpus B':                      'Corpus B',
        'Newspaper articles':            'Articles de presse',
        'Islamic publications':          'Publications islamiques',
        'Scope':                         'P\u00e9rim\u00e8tre',
        'Whole country':                 'Pays entier',
        'Single newspaper':              'Un seul journal',
        'Choose two corpora to compare': 'Choisissez deux corpus \u00e0 comparer',
        'Subject overlap': 'Sujets communs aux sélections',
        'Spatial coverage overlap': 'Lieux communs aux sélections',
        'Timeline (items per year)':     'Chronologie (items par ann\u00e9e)',
        'Top subjects (combined top 15)': 'Principaux sujets (top 15 combin\u00e9)',
        'Newspapers within each corpus': 'Journaux dans chaque corpus',
        'Shared':                        'Communs',
        'Only in A':                     'Seulement dans {name}',
        'Only in B':                     'Seulement dans {name}',
        'No overlap': 'Aucun mot-clé commun dans ces listes',
        'Unique subjects':               'Sujets distincts',
        'Geographic comparison':         'Comparaison g\u00e9ographique',
        'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
            'Lieux mentionn\u00e9s dans chaque corpus, reli\u00e9s \u00e0 l\u2019index d\u2019autorit\u00e9 IWAC. La taille de la bulle est proportionnelle au nombre d\u2019articles o\u00f9 ce lieu est balis\u00e9.',
        'AI sentiment comparison':       'Comparaison des sentiments (IA)',
        'Distribution of polarity and centrality in articles of each corpus, as rated by the AI models. The picker swaps the model; publications are not rated.':
            'Distribution de la polarit\u00e9 et de la centralit\u00e9 des articles de chaque corpus, \u00e9valu\u00e9es par les mod\u00e8les d\u2019IA. Le s\u00e9lecteur change de mod\u00e8le\u00a0; les publications ne sont pas \u00e9valu\u00e9es.',
        'Axis':                          'Axe',
        'Sentiment only on articles':    'Sentiments uniquement sur les articles',
        'Bubbles':                      'Bulles',
        'Show point bubbles':           'Afficher les bulles ponctuelles',
        'Diverging A minus B':          'Carte divergente A moins B',
    });
})();
