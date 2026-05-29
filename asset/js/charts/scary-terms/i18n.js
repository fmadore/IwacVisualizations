/**
 * IWAC Visualizations — Scary Terms block: i18n strings.
 *
 * Split out of scary-terms.js so the orchestrator carries logic, not a
 * 60-line translation table. Registers the block's en/fr strings into the
 * shared dictionary at parse time; loaded before the orchestrator (which
 * reads them via P.t('scary.*')).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

        ns.addTranslations('en', {
            'Loading scary terms':              'Loading "scary" terms',
            'scary.title':                      '"Scary" terms in the IWAC collection',
            'scary.description':                'Frequency of radical / extremism-related term families across West African Islamic periodicals and newspapers, 1961–2025.',
            'scary.view_mode':                  'View',
            'scary.bar_race':                   'Bar chart race',
            'scary.by_country':                 'By country',
            'scary.global_view':                'Global',
            'scary.matrix':                     'Co-occurrence matrix',
            'scary.country':                    'Country',
            'scary.all_countries':              'All countries',
            'scary.chart_title':                '"Scary" terms',
            'scary.country_chart_title':        '"Scary" terms in {country}',
            'scary.global_chart_title':         '"Scary" terms — global',
            'scary.matrix_chart_title':         'Co-occurrence matrix — global',
            'scary.matrix_country_chart_title': 'Co-occurrence matrix — {country}',
            'scary.matrix_description':         'How often pairs of "scary" term families appear together in the same article. Darker cells = more shared articles. The diagonal is hidden because self-co-occurrence is meaningless — hover a term label for its overall article count.',
            'scary.matrix_empty':               'No co-occurrences recorded for this slice.',
            'scary.matrix_pair_tooltip':        '{a} × {b}<br>{count} shared articles',
            'scary.matrix_articles':            '{count} articles',
            'scary.total_articles':             'Total articles',
            'scary.term_families':              'Term families',
            'scary.term_variants':              'Term variants',
            'scary.total_occurrences':          'Total occurrences',
            'scary.term_definitions':           'Term definitions',
            'scary.top_term':                   'Top term',
            'scary.play':                       'Play',
            'scary.pause':                      'Pause',
            'scary.previous':                   'Previous',
            'scary.next':                       'Next',
            'scary.reset':                      'Reset'
        });
        ns.addTranslations('fr', {
            'Loading scary terms':              'Chargement des termes \u00ab scary \u00bb',
            'scary.title':                      'Termes \u00ab scary \u00bb dans la collection IWAC',
            'scary.description':                'Fr\u00e9quence des familles de termes li\u00e9es \u00e0 la radicalisation et \u00e0 l\u2019extr\u00e9misme dans les journaux et p\u00e9riodiques ouest-africains, 1961-2025.',
            'scary.view_mode':                  'Vue',
            'scary.bar_race':                   'Course de barres',
            'scary.by_country':                 'Par pays',
            'scary.global_view':                'Global',
            'scary.matrix':                     'Matrice de co-occurrence',
            'scary.country':                    'Pays',
            'scary.all_countries':              'Tous les pays',
            'scary.chart_title':                'Termes \u00ab scary \u00bb',
            'scary.country_chart_title':        'Termes \u00ab scary \u00bb \u2014 {country}',
            'scary.global_chart_title':         'Termes \u00ab scary \u00bb \u2014 global',
            'scary.matrix_chart_title':         'Matrice de co-occurrence \u2014 global',
            'scary.matrix_country_chart_title': 'Matrice de co-occurrence \u2014 {country}',
            'scary.matrix_description':         'Fr\u00e9quence \u00e0 laquelle les paires de familles de termes \u00ab scary \u00bb apparaissent ensemble dans un m\u00eame article. Plus la cellule est sombre, plus les articles sont partag\u00e9s. La diagonale est masqu\u00e9e (la co-occurrence d\u2019un terme avec lui-m\u00eame n\u2019a pas de sens) \u2014 survolez une \u00e9tiquette pour voir le total d\u2019articles.',
            'scary.matrix_empty':               'Aucune co-occurrence enregistr\u00e9e pour cette s\u00e9lection.',
            'scary.matrix_pair_tooltip':        '{a} \u00d7 {b}<br>{count} articles partag\u00e9s',
            'scary.matrix_articles':            '{count} articles',
            'scary.total_articles':             'Articles totaux',
            'scary.term_families':              'Familles de termes',
            'scary.term_variants':              'Variantes',
            'scary.total_occurrences':          'Occurrences totales',
            'scary.term_definitions':           'D\u00e9finitions des termes',
            'scary.top_term':                   'Terme principal',
            'scary.play':                       'Lecture',
            'scary.pause':                      'Pause',
            'scary.previous':                   'Pr\u00e9c\u00e9dent',
            'scary.next':                       'Suivant',
            'scary.reset':                      'R\u00e9initialiser'
        });
})();
