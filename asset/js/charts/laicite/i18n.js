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
        'laicite.filter_all': 'All',

        // --- Phase 2: corpus linguistics ---
        'laicite.view_collocates': 'Collocates',
        'laicite.view_corpora': 'Corpora',
        'laicite.collocates_title': 'What laïcité keeps company with',
        'laicite.collocates_desc': 'Words that sit unusually close to the core forms, scored by log-likelihood and ranked by effect size. Slice by decade or country to see what changed.',
        'laicite.collocates_empty': 'No collocates survived the thresholds for this slice.',
        'laicite.collocates_method': 'Window ±{window} tokens; a term must appear in at least {docs} distinct documents.',
        'laicite.collocate_stats': 'effect {lr} · {count} occurrences · {docs} documents',
        'laicite.is_name': 'name',
        'laicite.is_name_hint': 'This token belongs to a catalogued person, place, organisation or event in the IWAC index. Kept and flagged rather than removed — who is named is a finding.',
        'laicite.scope_slice': 'Slice',
        'laicite.scope_global_all': 'All together',
        'laicite.scope_by_decade': 'By decade',
        'laicite.scope_by_country': 'By country',
        'laicite.scope_by_subset': 'By corpus',

        'laicite.implicit_title': 'The vocabulary of the unsaid',
        'laicite.implicit_desc': 'Items indexed under Laïcité that never use the word: how is the concept argued without the term?',
        'laicite.implicit_sizes': '{tagged} items tagged but never saying it, against {said} that do.',
        'laicite.implicit_negative': 'No shared vocabulary was found. These items appear to be tagged for heterogeneous reasons — each about its own matter — rather than because a consistent alternative vocabulary for laïcité exists in them. This is a negative result, reported rather than dressed up: the terms that reach statistical significance are almost all confined to a single document, which makes them that document’s subject matter, not the group’s signature.',
        'laicite.implicit_diagnostics': '{significant} terms reached significance; {surviving} appear in at least {docs} distinct documents.',
        'laicite.implicit_spread': 'Documents each significant term appears in',
        'laicite.implicit_spread_axis': 'Number of distinct documents (5+ grouped)',

        'laicite.corpora_title': 'Density by corpus',
        'laicite.corpora_rate_meta': '{items} items · {words} words · {occ} occurrences',
        'laicite.corpora_density_caveat': 'Density measures how much of a document is about laïcité, not how much attention a corpus pays it. A press article is dense because it is about laïcité and nothing else; a periodical issue is a whole magazine in which laïcité is one item. The yearly series below is the fairer test of sustained versus crisis-driven coverage.',
        'laicite.corpora_trend_title': 'Rate over time, by corpus',
        'laicite.corpora_trend_desc': 'Occurrences per 10,000 words per year. This is where continuous coverage separates from coverage that only appears in crises.',
        'laicite.per_10k': 'Per 10,000 words',
        'laicite.fingerprints_title': 'Frame fingerprints by outlet',
        'laicite.fingerprints_desc': 'Share of each outlet’s dossier items touching each frame, row-normalised so outlets of very different sizes read on one scale.',

        'laicite.seasonality_title': 'Seasonality',
        'laicite.axis_years': 'Years',
        'laicite.axis_seasons': 'Seasonality',
        'laicite.gregorian': 'Gregorian month',
        'laicite.hijri': 'Lunar month',
        'laicite.items': 'Items',
        'laicite.seasonality_desc': 'A lunar observance drifts about eleven days a year, so over sixty years it smears across every Gregorian month — a civil-calendar axis structurally cannot see Ramadan or the hajj. Both profiles are shown so a calendar-bound rhythm can be told from a civil one.',
        'laicite.seasonality_coverage': '{hijri} of {items} items carry a lunar date.',
        'laicite.months': 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec',
        'laicite.hijri_months': 'Muharram,Safar,Rabi I,Rabi II,Jumada I,Jumada II,Rajab,Shaban,Ramadan,Shawwal,Dhu al-Qida,Dhu al-Hijja',
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
        'laicite.filter_all': 'Tous',

        // --- Phase 2 ---
        'laicite.view_collocates': 'Cooccurrents',
        'laicite.view_corpora': 'Corpus',
        'laicite.collocates_title': 'Ce que la laïcité côtoie',
        'laicite.collocates_desc': 'Les mots qui se tiennent anormalement près des formes centrales, mesurés par log-vraisemblance et classés par taille d’effet. Découpez par décennie ou par pays pour voir ce qui a changé.',
        'laicite.collocates_empty': 'Aucun cooccurrent ne franchit les seuils pour ce découpage.',
        'laicite.collocates_method': 'Fenêtre ±{window} mots ; un terme doit apparaître dans au moins {docs} documents distincts.',
        'laicite.collocate_stats': 'effet {lr} · {count} occurrences · {docs} documents',
        'laicite.is_name': 'nom',
        'laicite.is_name_hint': 'Ce mot appartient à une personne, un lieu, une organisation ou un événement répertorié dans l’index IWAC. Conservé et signalé plutôt que supprimé : savoir qui est nommé est un résultat.',
        'laicite.scope_slice': 'Découpage',
        'laicite.scope_global_all': 'Tout confondu',
        'laicite.scope_by_decade': 'Par décennie',
        'laicite.scope_by_country': 'Par pays',
        'laicite.scope_by_subset': 'Par corpus',

        'laicite.implicit_title': 'Le vocabulaire du non-dit',
        'laicite.implicit_desc': 'Les documents indexés « Laïcité » qui n’emploient jamais le mot : comment argumente-t-on le concept sans le terme ?',
        'laicite.implicit_sizes': '{tagged} documents indexés sans le mot, face à {said} qui l’emploient.',
        'laicite.implicit_negative': 'Aucun vocabulaire commun n’a été trouvé. Ces documents semblent indexés pour des raisons hétérogènes — chacun sur son propre sujet — plutôt que parce qu’un vocabulaire alternatif cohérent de la laïcité s’y trouve. C’est un résultat négatif, rapporté tel quel : les termes qui atteignent la significativité statistique se limitent presque tous à un seul document, ce qui en fait le sujet de ce document et non la signature du groupe.',
        'laicite.implicit_diagnostics': '{significant} termes atteignent la significativité ; {surviving} apparaissent dans au moins {docs} documents distincts.',
        'laicite.implicit_spread': 'Documents où figure chaque terme significatif',
        'laicite.implicit_spread_axis': 'Nombre de documents distincts (5+ regroupés)',

        'laicite.corpora_title': 'Densité par corpus',
        'laicite.corpora_rate_meta': '{items} documents · {words} mots · {occ} occurrences',
        'laicite.corpora_density_caveat': 'La densité mesure quelle part d’un document porte sur la laïcité, non l’attention qu’un corpus lui accorde. Un article de presse est dense parce qu’il ne traite que de cela ; un numéro de périodique est un magazine entier où la laïcité n’est qu’un article parmi d’autres. La série annuelle ci-dessous teste plus justement une couverture continue face à une couverture de crise.',
        'laicite.corpora_trend_title': 'Taux dans le temps, par corpus',
        'laicite.corpora_trend_desc': 'Occurrences pour 10 000 mots par an. C’est là que la couverture continue se distingue de celle qui n’apparaît qu’en temps de crise.',
        'laicite.per_10k': 'Pour 10 000 mots',
        'laicite.fingerprints_title': 'Signatures thématiques par titre',
        'laicite.fingerprints_desc': 'Part des documents de chaque titre touchant à chaque cadre, normalisée par ligne pour que des titres de tailles très différentes se lisent sur une même échelle.',

        'laicite.seasonality_title': 'Saisonnalité',
        'laicite.axis_years': 'Années',
        'laicite.axis_seasons': 'Saisonnalité',
        'laicite.gregorian': 'Mois grégorien',
        'laicite.hijri': 'Mois lunaire',
        'laicite.items': 'Documents',
        'laicite.seasonality_desc': 'Une observance lunaire se décale d’environ onze jours par an : sur soixante ans elle se disperse sur tous les mois grégoriens, et un axe civil ne peut structurellement pas voir le ramadan ni le hajj. Les deux profils sont affichés afin de distinguer un rythme calendaire d’un rythme civil.',
        'laicite.seasonality_coverage': '{hijri} documents sur {items} portent une date lunaire.',
        'laicite.months': 'janv.,févr.,mars,avr.,mai,juin,juil.,août,sept.,oct.,nov.,déc.',
        'laicite.hijri_months': 'Mouharram,Safar,Rabi I,Rabi II,Joumada I,Joumada II,Rajab,Chaabane,Ramadan,Chawwal,Dhou al-qi\u2019da,Dhou al-hijja',
    });
})();
