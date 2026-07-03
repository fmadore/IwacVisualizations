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
            'Loading periodicals overview':       'Loading periodicals overview',
            'periodicals.issues':                 'Issues',
            'periodicals.periodicals':            'Periodicals',
            'periodicals.runs_title':             'Periodical runs',
            'periodicals.runs_desc':              'Publication span of each periodical, from its first to its last issue in the collection, colored by country.',
            'periodicals.holdings_title':         'Issue holdings by year',
            'periodicals.holdings_desc':          'One row per periodical (same order as the runs above), one column per year; cell intensity is the number of issues held. A blank cell inside a run is a year with no held issue — a collection gap, not necessarily a publication gap.',
            'periodicals.holdings_tip':           '{name} · {year} — {count} issues',
            'periodicals.issues_per_year_title':  'Issues per year',
            'periodicals.subjects_title':         'Top subjects',
            'periodicals.wordcloud_title':        'Most frequent terms',
            'periodicals.wordcloud_desc':         'The most frequent words across every issue’s full text (lemmatized, with common function words removed).'
        });
        ns.addTranslations('fr', {
            'Loading periodicals overview':       'Chargement des périodiques',
            'periodicals.issues':                 'Numéros',
            'periodicals.periodicals':            'Périodiques',
            'periodicals.runs_title':             'Parutions des périodiques',
            'periodicals.runs_desc':              'Période de parution de chaque périodique, du premier au dernier numéro conservé dans la collection, colorée par pays.',
            'periodicals.holdings_title':         'Numéros conservés par année',
            'periodicals.holdings_desc':          'Une ligne par périodique (même ordre que les parutions ci-dessus), une colonne par année ; l’intensité indique le nombre de numéros conservés. Une case vide au sein d’une parution est une année sans numéro conservé — une lacune de la collection, pas nécessairement une interruption de parution.',
            'periodicals.holdings_tip':           '{name} · {year} — {count} numéros',
            'periodicals.issues_per_year_title':  'Numéros par année',
            'periodicals.subjects_title':         'Principaux sujets',
            'periodicals.wordcloud_title':        'Termes les plus fréquents',
            'periodicals.wordcloud_desc':         'Les mots les plus fréquents dans le texte intégral de tous les numéros (lemmatisés, mots outils retirés).'
        });
})();
