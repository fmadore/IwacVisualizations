/**
 * IWAC Visualizations — Periodicals Overview block: i18n strings.
 *
 * Split out of periodicals-overview.js (scary-terms pattern) so the
 * orchestrator carries logic, not a translation table; loaded before the
 * orchestrator via the phtml `panels` list.
 *
 * Generic keys the block also uses — 'Languages', 'Countries',
 * 'Total pages', 'Total words', 'period_covered', 'Logarithmic scale',
 * 'lang_<name>' — already live in the shared dictionary (iwac-i18n.js).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

        ns.addTranslations('en', {
            'periodicals.subjects_desc': 'Most frequent catalogue subject tags assigned to the issues. Each issue can have several tags; these are separate from the themes identified by the statistical model below.',
            'periodicals.countries_desc': 'Issues by recorded country of publication. Counts reflect the periodicals and years represented in IWAC.',
            'periodicals.languages_desc': 'Issues by their recorded languages. Multilingual issues may contribute to several categories.',
            'periodicals.years_desc': 'Issues held in IWAC by publication year and country. Missing years can reflect gaps in the collection rather than interruptions in publication.',
            'Loading periodicals overview':       'Loading periodicals overview',
            'periodicals.issues':                 'Issues',
            'periodicals.periodicals':            'Periodicals',
            'periodicals.runs_title':             'Periodical runs',
            'periodicals.runs_desc':              'First and last issue held for each periodical, coloured by country of publication. A bar spans the collection’s holdings and may include missing years; it does not establish the periodical’s founding, closure or continuous publication.',
            // Window disclosure (P.buildWindowDisclosure). Rows run oldest
            // first, so the collapsed view is "the earliest N" — a statement
            // a reader can evaluate, unlike a bare row count.
            'periodicals.runs_window_note':       'Showing the {shown} earliest of {total} periodicals.',
            'periodicals.runs_window_all':        'Showing all {total} periodicals.',
            'periodicals.runs_show_all':          'Show all {total}',
            'periodicals.runs_show_top':          'Show earliest {shown}',
            'periodicals.holdings_title':         'Issue holdings by year',
            'periodicals.holdings_desc':          'One row per periodical, in the same order as the runs above, and one column per year. The darker the cell, the more issues are held. A blank cell inside a run is a year with no issue in the collection, which is a gap in the holdings and not necessarily a gap in publication.',
            'periodicals.holdings_tip':           '{name} · {year} — {count} issues',
            'periodicals.issues_per_year_title':  'Issues per year',
            'periodicals.subjects_title':         'Top subjects',
            'periodicals.wordcloud_title':        'Most frequent terms',
            'periodicals.wordcloud_desc':         'The most frequent words across the full text of every issue. Words are reduced to their dictionary form, and common grammatical words are removed.',
            'periodicals.topics_time_title':      'Themes over time',
            'periodicals.topics_time_desc':       'Average weight assigned to each theme in the modelled issues published each year. A statistical topic model (LDA) identifies patterns of words used together in the extracted full text. An issue can contribute to several themes. These weights are model estimates, not measured proportions of pages.',
            'periodicals.topics_year_issues':     'Based on {count} issues this year',
            'periodicals.topics_ranking_title':   'Themes across the collection',
            'periodicals.topics_ranking_desc':    'Average model weight of each theme across the issues analysed. Select a theme to see examples with high weights. The ranking describes the modelled portion of the collection.',
            'periodicals.topics_bar_tip':         '{mass}% average model weight · recorded in {issues} issues',
            'periodicals.topics_bar_dominant':    'Strongest theme in {dominant} of them',
            'periodicals.topics_bar_periodicals': 'Spread across {periodicals} periodicals',
            'periodicals.topics_issues_title':    'Issues where this theme is strongest',
            'periodicals.topics_issues_desc':     'Issues ranked by the model weight of the selected theme, with at most three examples per periodical. A high weight suggests an issue to read; the theme need not be its main one.',
            'periodicals.topics_issues_selected': 'Showing: {topic}',
            'periodicals.topics_issues_selected_spread': 'Showing: {topic} — present in {issues} issues across {periodicals} periodicals',
            'periodicals.topics_card_share':      '{share}% model weight',
            'periodicals.topics_card_secondary':  'Not this issue’s main theme',
            'periodicals.topics_card_issue':      'No. {issue}',
            'periodicals.topics_coverage':        '{topics} themes identified across {modelled} of {total} issues ({percent}%). Issues without usable model results are excluded from these panels.',
            'periodicals.topics_mixture_note':    'An issue can contain several themes. Its strongest theme has an average model weight of {prob}%, so these panels retain the mixture instead of assigning the whole issue to one theme.',
            'periodicals.topics_source_note':     'The model analyses extracted full text. Only the three strongest themes per issue are stored, with a combined average weight of {mass}%. The remaining model weight is omitted, so the chart need not reach 100%. These weights are estimates of thematic composition, not measured page shares.',
            'periodicals.topics_absent':          'This data snapshot predates the theme model for periodicals.'
        });
        ns.addTranslations('fr', {
            'periodicals.subjects_desc': 'Mots-clés de sujets les plus fréquemment attribués aux numéros dans le catalogue. Chaque numéro peut en porter plusieurs ; ils sont distincts des thèmes identifiés par le modèle statistique ci-dessous.',
            'periodicals.countries_desc': 'Numéros par pays de publication enregistré. Les nombres reflètent les périodiques et les années représentés dans IWAC.',
            'periodicals.languages_desc': 'Numéros selon leurs langues enregistrées. Les numéros multilingues peuvent contribuer à plusieurs catégories.',
            'periodicals.years_desc': 'Numéros conservés dans IWAC par année de publication et par pays. Les années manquantes peuvent refléter des lacunes de la collection plutôt que des interruptions de publication.',
            'Loading periodicals overview':       'Chargement des périodiques',
            'periodicals.issues':                 'Numéros',
            'periodicals.periodicals':            'Périodiques',
            'periodicals.runs_title':             'Parutions des périodiques',
            'periodicals.runs_desc':              'Premier et dernier numéros conservés pour chaque périodique, avec une couleur par pays de publication. Une barre couvre la période représentée dans la collection et peut inclure des années manquantes ; elle n’établit ni la fondation, ni la fermeture, ni une publication continue du périodique.',
            'periodicals.runs_window_note':       'Affichage des {shown} périodiques les plus anciens sur {total}.',
            'periodicals.runs_window_all':        'Affichage des {total} périodiques.',
            'periodicals.runs_show_all':          'Afficher les {total}',
            'periodicals.runs_show_top':          'Afficher les {shown} plus anciens',
            'periodicals.holdings_title':         'Numéros conservés par année',
            'periodicals.holdings_desc':          'Une ligne par périodique, dans le même ordre que les parutions ci-dessus, et une colonne par année. Plus la case est sombre, plus le nombre de numéros conservés est élevé. Une case vide au sein d’une parution est une année sans numéro conservé : une lacune de la collection, pas nécessairement une interruption de parution.',
            'periodicals.holdings_tip':           '{name} · {year} — {count} numéros',
            'periodicals.issues_per_year_title':  'Numéros par année',
            'periodicals.subjects_title':         'Principaux sujets',
            'periodicals.wordcloud_title':        'Termes les plus fréquents',
            'periodicals.wordcloud_desc':         'Les mots les plus fréquents dans le texte intégral de tous les numéros. Les mots sont ramenés à leur forme de dictionnaire et les mots grammaticaux courants sont retirés.',
            'periodicals.topics_time_title':      'Thèmes au fil du temps',
            'periodicals.topics_time_desc':       'Poids moyen attribué à chaque thème dans les numéros modélisés publiés chaque année. Un modèle statistique de thèmes (LDA) repère les mots employés ensemble dans le texte intégral extrait. Un numéro peut contribuer à plusieurs thèmes. Ces poids sont des estimations du modèle, et non des proportions mesurées de pages.',
            'periodicals.topics_year_issues':     'Sur la base de {count} numéros cette année-là',
            'periodicals.topics_ranking_title':   'Thèmes dans l’ensemble de la collection',
            'periodicals.topics_ranking_desc':    'Poids moyen de chaque thème selon le modèle pour les numéros analysés. Sélectionnez un thème pour voir des exemples aux poids élevés. Le classement décrit la partie modélisée de la collection.',
            'periodicals.topics_bar_tip':         'Poids moyen dans le modèle : {mass} % · enregistré dans {issues} numéros',
            'periodicals.topics_bar_dominant':    'Thème principal dans {dominant} d’entre eux',
            'periodicals.topics_bar_periodicals': 'Réparti sur {periodicals} périodiques',
            'periodicals.topics_issues_title':    'Numéros où ce thème est le plus présent',
            'periodicals.topics_issues_desc':     'Numéros classés selon le poids du thème sélectionné dans le modèle, avec au plus trois exemples par périodique. Un poids élevé suggère un numéro à lire ; le thème n’est pas nécessairement son thème principal.',
            'periodicals.topics_issues_selected': 'Thème affiché : {topic}',
            'periodicals.topics_issues_selected_spread': 'Thème affiché : {topic} — présent dans {issues} numéros répartis sur {periodicals} périodiques',
            'periodicals.topics_card_share':      'Poids dans le modèle : {share} %',
            'periodicals.topics_card_secondary':  'Thème secondaire de ce numéro',
            'periodicals.topics_card_issue':      'N° {issue}',
            'periodicals.topics_coverage':        '{topics} thèmes identifiés dans {modelled} numéros sur {total} ({percent} %). Les numéros sans résultats de modélisation exploitables sont exclus de ces panneaux.',
            'periodicals.topics_mixture_note':    'Un numéro peut contenir plusieurs thèmes. Son thème principal a un poids moyen de {prob} % dans le modèle ; ces panneaux conservent donc le mélange thématique sans attribuer le numéro entier à un seul thème.',
            'periodicals.topics_source_note':     'Le modèle analyse le texte intégral extrait. Seuls les trois thèmes les plus forts de chaque numéro sont enregistrés, avec un poids moyen cumulé de {mass} %. Le poids restant est omis : le graphique ne doit donc pas nécessairement atteindre 100 %. Ces poids estiment la composition thématique, sans mesurer des proportions de pages.',
            'periodicals.topics_absent':          'Cet instantané des données est antérieur au modèle thématique des périodiques.'
        });
})();
