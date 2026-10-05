/**
 * IWAC Visualizations — Topic Explorer translations
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
        'desc_topic_treemap':           'Each rectangle is one of the 30 themes identified by a statistical topic model (LDA), which groups words commonly used together. Its area shows the number of articles assigned that theme as their strongest match. These groupings support exploration and need interpretation through the texts. Click a rectangle to explore a theme.',
        'cal_panel_title':              'Publication calendar',
        'desc_topic_calendar':          'When articles classified into this topic were published. Only articles with a full date, down to the day, appear here; those dated to a year or a month alone are left out rather than placed on 1 January.',
        'topic_copy_link':              'Copy link to this topic',
        'topic_link_copied':            'Link copied',
        'desc_topic_countries':         'Distribution of articles in this topic by country of publication.',
        'desc_topic_newspapers':        'Newspapers and periodicals where this topic appears most often.',
        'desc_topic_top_articles':      'Articles ranked by the weight the statistical topic model assigns to this theme. A high weight makes an article a useful example to examine; it is not a probability that the interpretation is correct.',
        'topics_over_time_title':       'Topics over time',
        'topics_over_time_desc':        'Distribution of modelled themes in the collected newspaper articles by publication year. The 12 largest themes are shown separately; the rest are grouped as “Other topics”. Select a band to explore its theme.',
        'topics_weighting_dominant':    'Dominant topic',
        'topics_weighting_weighted':    'Probability-weighted',
        'topics_over_time_dominant_note': 'Each band is a topic’s share of the articles it was the single best label for that year, so every year sums to 100%. An article the model split evenly between three topics counts wholly for one of them.',
        'topics_over_time_weighted_note': 'Each band is the average probability the model assigned to that topic across the year’s articles, so an evenly split article contributes to all three of its topics. Only the top {k} topics of each article are recorded, so the stack tops out around {mass}% rather than 100%. The gap is thematic weight spread too thinly to be stored, and not articles left unclassified.',
    });

    ns.addTranslations('fr', {
        'Topic distribution':           'Distribution des th\u00e8mes',
        'All topics':                   'Tous les th\u00e8mes',
        'Topics':                       'Th\u00e8mes',
        'Articles classified':          'Articles classifi\u00e9s',
        'Outliers':                     'Hors th\u00e8me',
        'Back to all topics':           'Retour \u00e0 tous les th\u00e8mes',
        'cal_panel_title':              'Calendrier de publication',
        'topic_copy_link':              'Copier le lien vers ce th\u00e8me',
        'topic_link_copied':            'Lien copi\u00e9',
        'Most representative articles': 'Articles les plus repr\u00e9sentatifs',
        'desc_topic_treemap':           'Chaque rectangle correspond à l’un des 30 thèmes identifiés par un modèle statistique (LDA), qui regroupe les mots fréquemment employés ensemble. Sa surface indique le nombre d’articles auxquels ce thème est attribué comme correspondance principale. Ces regroupements facilitent l’exploration et demandent une interprétation à partir des textes. Cliquez sur un rectangle pour explorer un thème.',
        'desc_topic_calendar':          'Dates de parution des articles class\u00e9s dans ce th\u00e8me. Seuls les articles dont la date est compl\u00e8te, jusqu\u2019au jour, figurent ici ; ceux dat\u00e9s d\u2019une ann\u00e9e ou d\u2019un mois seulement sont \u00e9cart\u00e9s plut\u00f4t que ramen\u00e9s au 1er janvier.',
        'desc_topic_countries':         'R\u00e9partition des articles de ce th\u00e8me par pays de publication.',
        'desc_topic_newspapers':        'Journaux et p\u00e9riodiques o\u00f9 ce th\u00e8me appara\u00eet le plus souvent.',
        'desc_topic_top_articles':      'Articles classés selon le poids que le modèle statistique attribue à ce thème. Un poids élevé fait de l’article un exemple à examiner ; il ne donne pas la probabilité que l’interprétation soit correcte.',
        'topics_over_time_title':       'Th\u00e8mes au fil du temps',
        'topics_over_time_desc':        'Répartition des thèmes modélisés dans les articles de presse collectés, par année de publication. Les 12 thèmes les plus importants sont affichés séparément ; les autres sont regroupés sous « Autres thèmes ». Sélectionnez une bande pour explorer son thème.',
        'topics_weighting_dominant':    'Th\u00e8me dominant',
        'topics_weighting_weighted':    'Pond\u00e9r\u00e9 par probabilit\u00e9',
        'topics_over_time_dominant_note': 'Chaque bande donne la part d\u2019un th\u00e8me parmi les articles dont il est le meilleur libell\u00e9 unique pour l\u2019ann\u00e9e ; le total de chaque ann\u00e9e fait donc 100 %. Un article que le mod\u00e8le r\u00e9partit \u00e0 parts \u00e9gales entre trois th\u00e8mes est compt\u00e9 enti\u00e8rement pour l\u2019un d\u2019eux.',
        'topics_over_time_weighted_note': 'Chaque bande correspond \u00e0 la probabilit\u00e9 moyenne attribu\u00e9e par le mod\u00e8le \u00e0 ce th\u00e8me sur les articles de l\u2019ann\u00e9e ; un article r\u00e9parti \u00e0 parts \u00e9gales contribue donc \u00e0 ses trois th\u00e8mes. Seuls les {k} th\u00e8mes principaux de chaque article sont enregistr\u00e9s, si bien que l\u2019empilement plafonne autour de {mass} % et non \u00e0 100 %. L\u2019\u00e9cart correspond \u00e0 une masse th\u00e9matique trop dispers\u00e9e pour \u00eatre enregistr\u00e9e, et non \u00e0 des articles laiss\u00e9s sans classement.',
    });
})();
