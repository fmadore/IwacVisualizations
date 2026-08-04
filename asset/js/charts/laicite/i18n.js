/**
 * IWAC Visualizations — Laïcité block: translations (issue #14).
 *
 * Registered at parse time, before the orchestrator loads. French values use
 * \uXXXX escapes for every non-ASCII character, matching the convention in
 * every other block's i18n file.
 *
 * The block label is "Laïcité" in both locales deliberately: it is the term
 * of art in the anglophone literature too, and the collection's own authority
 * record (index o:id 5) carries "Secularism" only as an alternative title.
 * The English description carries "secularism" so English search finds it.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) { return; }

    ns.addTranslations('en', {
        'Loading laïcité dossier': 'Loading laïcité dossier',
        'laicite.title': 'Laïcité in the IWAC collection',
        'laicite.description': 'How one contested political concept is argued about — by whom, in which arenas, and over sixty years. Press coverage, Islamic periodicals, primary sources and scholarship are counted separately throughout: they are different kinds of evidence.',

        // Views
        'laicite.view_overview': 'Overview',
        'laicite.view_trends': 'Timeline',
        'laicite.view_documents': 'Primary sources',
        'laicite.view_concordance': 'Concordance',

        // Overview / KPIs
        'laicite.kpi_members': 'Items in the dossier',
        'laicite.kpi_tagged': 'Tagged “Laïcité”',
        'laicite.kpi_said': 'Use the word',
        'laicite.kpi_occurrences': 'Occurrences',
        'laicite.kpi_countries': 'Countries',
        'laicite.kpi_span': 'Year span',
        'laicite.kpi_newspapers': 'Newspapers',
        'laicite.authority_link': 'Authority record',
        'laicite.overview_desc': 'The dossier is built from the curated subject tag and from the text. Where the two disagree is itself a finding, not a data-quality complaint.',

        // Venn
        'laicite.venn_title': 'Tag vs. text',
        'laicite.venn_tagged_only': 'Tagged, never says it',
        'laicite.venn_both': 'Tagged and says it',
        'laicite.venn_said_only': 'Says it, not tagged',
        'laicite.venn_hint': 'Which items are about laïcité without ever using the word — and which use it without being indexed under it.',

        // Subsets
        'laicite.subset_articles': 'Press articles',
        'laicite.subset_publications': 'Islamic periodicals',
        'laicite.subset_documents': 'Primary sources',
        'laicite.subset_references': 'Scholarship',
        'laicite.subset_table_title': 'By corpus',
        'laicite.col_corpus': 'Corpus',
        'laicite.col_members': 'In dossier',
        'laicite.col_tagged': 'Tagged',
        'laicite.col_said': 'Says it',
        'laicite.col_occurrences': 'Occurrences',
        'laicite.col_readable': 'Readable',
        'laicite.col_span': 'Span',
        'laicite.no_sum_note': 'Never summed across corpora: a 300-page monograph and a 400-word news item are not commensurable units.',

        // Rights
        'laicite.rights_title': 'What can be quoted here',
        'laicite.rights_body': 'Counts are computed over all text. Readable snippets are limited to items whose full text is public in the collection, and that share is very uneven between corpora — so it is reported per corpus rather than as one overall percentage.',
        'laicite.rights_readable': '{quotable} of {total} occurrences are readable here',

        // Frames
        'laicite.frames_title': 'Argumentative frames',
        'laicite.frames_desc': 'The lexicon is grouped by what is being argued, not by word shape. Only the core frames decide membership; the rest are annotations computed within the dossier.',
        'laicite.frame_share': '{percent}% of items',
        'laicite.membership_note': 'Membership frame',
        'laicite.empty_frame_note': 'Kept although nearly empty: the West African press argues in the juridical-political register, not the sociological one. The absence is the finding.',

        // Timeline
        'laicite.trends_chart_title': 'Laïcité over time',
        'laicite.trends_country_chart_title': 'Laïcité over time — {country}',
        'laicite.occurrences': 'Occurrences',
        'laicite.show_events': 'Show historical events',
        'laicite.scope_global': 'All countries',
        'laicite.scope_subset': 'Corpus',
        'laicite.trends_desc': 'One line per argumentative frame. Event markers are hand-curated; those drawn from the collection link to the record or to the source document that generated the coverage.',
        'Historical events': 'Historical events',
        'Source document': 'source document',
        'Record': 'record',

        // Documents
        'laicite.documents_title': 'Primary-source dossier',
        'laicite.documents_desc': 'Statutes, minutes, ministerial reports and petitions — laïcité being negotiated, rather than reported after the fact. These are never averaged into the press counts.',
        'laicite.documents_empty': 'No primary sources matched.',
        'laicite.doc_pages': '{count} pages',
        'laicite.doc_words': '{count} words',
        'laicite.doc_tagged': 'Tagged “Laïcité”',
        'laicite.doc_full_text': 'Full text public',
        'laicite.doc_read': 'Read the record',
        'laicite.doc_ai_description': 'AI-generated description',

        // Concordance
        'laicite.concordance_title': 'Concordance',
        'laicite.concordance_desc': 'Every readable occurrence in context. This is the view that makes the block a research instrument rather than an overview.',
        'laicite.concordance_search': 'Search within the lines',
        'laicite.concordance_count': '{count} lines',
        'laicite.concordance_withheld': '{count} further occurrences are not readable here because the item’s full text is not public.',
        'laicite.concordance_loading': 'Loading concordance',
        'laicite.concordance_empty': 'No lines match these filters.',
        'concordance.tagged_hint': 'This item also carries the curated “Laïcité” subject tag.',
        'tagged': 'tagged',
        'laicite.filter_frame': 'Frame',
        'laicite.filter_country': 'Country',
        'laicite.filter_all': 'All'
    });

    ns.addTranslations('fr', {
        'Loading laïcité dossier': 'Chargement du dossier laïcité',
        'laicite.title': 'La laïcité dans la collection IWAC',
        'laicite.description': 'Comment un concept politique contesté est débattu — par qui, dans quelles arènes, et sur soixante ans. Presse, périodiques islamiques, sources primaires et travaux savants sont comptés séparément : ce sont des types de preuve différents.',

        'laicite.view_overview': 'Vue d’ensemble',
        'laicite.view_trends': 'Chronologie',
        'laicite.view_documents': 'Sources primaires',
        'laicite.view_concordance': 'Concordance',

        'laicite.kpi_members': 'Documents du dossier',
        'laicite.kpi_tagged': 'Indexés « Laïcité »',
        'laicite.kpi_said': 'Emploient le mot',
        'laicite.kpi_occurrences': 'Occurrences',
        'laicite.kpi_countries': 'Pays',
        'laicite.kpi_span': 'Période',
        'laicite.kpi_newspapers': 'Journaux',
        'laicite.authority_link': 'Notice d’autorité',
        'laicite.overview_desc': 'Le dossier est construit à partir du mot-clé indexé et du texte. Là où les deux divergent, c’est un résultat en soi, pas un défaut de catalogage.',

        'laicite.venn_title': 'Mot-clé et texte',
        'laicite.venn_tagged_only': 'Indexés sans le mot',
        'laicite.venn_both': 'Indexés et le mot',
        'laicite.venn_said_only': 'Le mot sans indexation',
        'laicite.venn_hint': 'Quels documents traitent de la laïcité sans jamais employer le mot — et lesquels l’emploient sans être indexés sous ce terme.',

        'laicite.subset_articles': 'Articles de presse',
        'laicite.subset_publications': 'Périodiques islamiques',
        'laicite.subset_documents': 'Sources primaires',
        'laicite.subset_references': 'Travaux savants',
        'laicite.subset_table_title': 'Par corpus',
        'laicite.col_corpus': 'Corpus',
        'laicite.col_members': 'Au dossier',
        'laicite.col_tagged': 'Indexés',
        'laicite.col_said': 'Emploient le mot',
        'laicite.col_occurrences': 'Occurrences',
        'laicite.col_readable': 'Lisibles',
        'laicite.col_span': 'Période',
        'laicite.no_sum_note': 'Jamais additionnés entre corpus : une monographie de 300 pages et une brève de 400 mots ne sont pas des unités comparables.',

        'laicite.rights_title': 'Ce qui peut être cité ici',
        'laicite.rights_body': 'Les décomptes portent sur l’ensemble du texte. Les extraits lisibles se limitent aux documents dont le texte intégral est public dans la collection, et cette proportion varie fortement d’un corpus à l’autre — elle est donc indiquée par corpus plutôt qu’en pourcentage global.',
        'laicite.rights_readable': '{quotable} occurrences sur {total} sont lisibles ici',

        'laicite.frames_title': 'Cadres argumentatifs',
        'laicite.frames_desc': 'Le lexique est groupé par ce qui est débattu, non par la forme des mots. Seuls les cadres centraux déterminent l’appartenance au dossier ; les autres sont des annotations calculées à l’intérieur de celui-ci.',
        'laicite.frame_share': '{percent} % des documents',
        'laicite.membership_note': 'Cadre d’appartenance',
        'laicite.empty_frame_note': 'Conservé bien que presque vide : la presse ouest-africaine argumente dans le registre juridico-politique, non sociologique. L’absence est le résultat.',

        'laicite.trends_chart_title': 'La laïcité dans le temps',
        'laicite.trends_country_chart_title': 'La laïcité dans le temps — {country}',
        'laicite.occurrences': 'Occurrences',
        'laicite.show_events': 'Afficher les événements historiques',
        'laicite.scope_global': 'Tous les pays',
        'laicite.scope_subset': 'Corpus',
        'laicite.trends_desc': 'Une ligne par cadre argumentatif. Les repères d’événements sont curatés à la main ; ceux issus de la collection renvoient à la notice ou au document source qui a engendré la couverture.',
        'Historical events': 'Événements historiques',
        'Source document': 'document source',
        'Record': 'notice',

        'laicite.documents_title': 'Dossier de sources primaires',
        'laicite.documents_desc': 'Statuts, procès-verbaux, rapports ministériels et pétitions — la laïcité en cours de négociation, plutôt que rapportée après coup. Jamais moyennées avec les décomptes de presse.',
        'laicite.documents_empty': 'Aucune source primaire ne correspond.',
        'laicite.doc_pages': '{count} pages',
        'laicite.doc_words': '{count} mots',
        'laicite.doc_tagged': 'Indexé « Laïcité »',
        'laicite.doc_full_text': 'Texte intégral public',
        'laicite.doc_read': 'Consulter la notice',
        'laicite.doc_ai_description': 'Description générée par IA',

        'laicite.concordance_title': 'Concordance',
        'laicite.concordance_desc': 'Chaque occurrence lisible dans son contexte. C’est la vue qui fait de ce bloc un instrument de recherche plutôt qu’une synthèse.',
        'laicite.concordance_search': 'Rechercher dans les lignes',
        'laicite.concordance_count': '{count} lignes',
        'laicite.concordance_withheld': '{count} autres occurrences ne sont pas lisibles ici car le texte intégral du document n’est pas public.',
        'laicite.concordance_loading': 'Chargement de la concordance',
        'laicite.concordance_empty': 'Aucune ligne ne correspond à ces filtres.',
        'concordance.tagged_hint': 'Ce document porte aussi le mot-clé indexé « Laïcité ».',
        'tagged': 'indexé',
        'laicite.filter_frame': 'Cadre',
        'laicite.filter_country': 'Pays',
        'laicite.filter_all': 'Tous'
    });
})();
