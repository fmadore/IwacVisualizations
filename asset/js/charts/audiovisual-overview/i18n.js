/**
 * IWAC Visualizations — Audiovisual Overview block: i18n strings.
 *
 * Split out of audiovisual-overview.js (scary-terms / periodicals pattern)
 * so the orchestrator carries logic, not a translation table; loaded before
 * the orchestrator via the phtml `panels` list.
 *
 * Generic keys the block also uses — 'period_covered', 'duration_hours',
 * 'duration_minutes', 'Countries', the window-disclosure set — already live
 * in the shared dictionary (iwac-i18n.js).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

    ns.addTranslations('en', {
        'Loading audiovisual overview':   'Loading audiovisual overview',

        'av.items':                       'Recordings',
        'av.runtime':                     'Total runtime',
        'av.channels':                    'Sources',
        'av.countries':                   'Countries',

        // The two populations. `source_type` is the spine of the subset:
        // one class holding archival deposits and embedded web video, which
        // differ in every property a reader would otherwise average over.
        // Printed as the block's standfirst, so the panels below are read
        // as a comparison rather than as one population with outliers.
        'av.populations_desc':            'The collection includes deposited recordings and videos published online by West African channels. The panels distinguish these sources so that their coverage and recording lengths can be compared.',
        'av.source_youtube':              'Published on the web',
        'av.source_deposited':            'Deposited with the collection',
        'av.source_unknown':              'Source not recorded',

        // The headline panel. The measure toggle is the finding: item counts
        // and runtime rank the sources differently, and a reader who only
        // ever sees one measure never learns that.
        'av.channels_title':              'Sources',
        'av.channels_desc':               'Sources ranked by the number of collected recordings or their combined duration. Switch measures to compare the volume of recordings with the amount of listening or viewing time. Totals reflect the material in the collection.',
        'av.countries_title':             'Countries',
        'av.countries_desc':              'Countries recorded for the material, ranked by number of recordings or combined duration. Only known durations contribute to runtime totals.',
        'av.measure_items':               'Recordings',
        'av.measure_runtime':             'Runtime',
        'av.tip_items':                   '{count} recordings · {duration} in total',
        'av.tip_runtime':                 '{duration} across {count} recordings',
        'av.tip_median':                  'Typical length {duration}',

        'av.durations_title':             'How long the recordings run',
        'av.durations_desc':              'Recordings grouped by duration. Compare the distribution of online videos with deposited recordings. Recordings without a known duration are omitted.',
        'av.bucket_lt2m':                 'Under 2 min',
        'av.bucket_2to5m':                '2–5 min',
        'av.bucket_5to15m':               '5–15 min',
        'av.bucket_15to60m':              '15–60 min',
        'av.bucket_gt1h':                 'Over 1 h',

        'av.timeline_title':              'Published per year',
        'av.timeline_desc':               'Collected recordings by publication year and source. This timeline follows publication dates, not dates of addition to IWAC; changes also reflect which material has been collected.',
        'av.timeline_other':              'Other sources',
        'av.timeline_partial':            '{year} is incomplete — the collection runs to {date}.',
        'av.timeline_undated':            '{count} recordings carry no publication date and are not shown.',

        // The honest home for the thin fields. A 99%-populated `language`
        // column charted on its own would read as a finding about the
        // sources; as a completeness row beside `subject` at 1.5% it reads
        // as what it is — metadata surfaces of very different maturity.
        'av.coverage_title':              'Information available in the catalogue',
        'av.coverage_desc':               'Share of recording records with a value in each catalogue field. A completed field indicates available information, without assessing its accuracy or detail. An empty field does not establish that the recording lacks the corresponding content.',
        'av.coverage_description':        'Description',
        'av.coverage_transcription':      'Transcription',
        'av.coverage_pub_date':           'Publication date',
        'av.coverage_thumbnail':          'Still image',
        'av.coverage_language':           'Language',
        'av.coverage_creator':            'Creator',
        'av.coverage_subject':            'Subject',
        'av.coverage_tip':                '{present} of {total} recordings ({percent}%)',

        'av.recent_title':                'Most recent',
        'av.recent_desc':                 'The newest recordings in the collection.',
        'av.recent_watch':                'Watch',
        'av.recent_open':                 'Open in the collection'
    });

    ns.addTranslations('fr', {
        'Loading audiovisual overview':   'Chargement de l’aperçu audiovisuel',

        'av.items':                       'Enregistrements',
        'av.runtime':                     'Durée totale',
        'av.channels':                    'Sources',
        'av.countries':                   'Pays',

        'av.populations_desc':            'La collection comprend des enregistrements déposés et des vidéos publiées en ligne par des chaînes ouest-africaines. Les panneaux distinguent ces sources pour comparer leur couverture et la durée des enregistrements.',
        'av.source_youtube':              'Publié sur le web',
        'av.source_deposited':            'Déposé dans la collection',
        'av.source_unknown':              'Source non renseignée',

        'av.channels_title':              'Sources',
        'av.channels_desc':               'Sources classées par nombre d’enregistrements collectés ou par durée cumulée. Changez de mesure pour comparer le nombre d’enregistrements au temps d’écoute ou de visionnage. Les totaux portent sur les documents de la collection.',
        'av.countries_title':             'Pays',
        'av.countries_desc':              'Pays enregistrés pour les documents, classés par nombre d’enregistrements ou par durée cumulée. Seules les durées connues contribuent aux totaux de durée.',
        'av.measure_items':               'Enregistrements',
        'av.measure_runtime':             'Durée',
        'av.tip_items':                   '{count} enregistrements · {duration} au total',
        'av.tip_runtime':                 '{duration} pour {count} enregistrements',
        'av.tip_median':                  'Durée habituelle {duration}',

        'av.durations_title':             'Durée des enregistrements',
        'av.durations_desc':              'Enregistrements regroupés par durée. Comparez la répartition des vidéos en ligne et des enregistrements déposés. Ceux dont la durée est inconnue sont omis.',
        'av.bucket_lt2m':                 'Moins de 2 min',
        'av.bucket_2to5m':                '2–5 min',
        'av.bucket_5to15m':               '5–15 min',
        'av.bucket_15to60m':              '15–60 min',
        'av.bucket_gt1h':                 'Plus d’1 h',

        'av.timeline_title':              'Publications par année',
        'av.timeline_desc':               'Enregistrements collectés par année de publication et par source. Cette chronologie suit les dates de publication, et non d’ajout à IWAC ; les variations reflètent aussi les choix de collecte.',
        'av.timeline_other':              'Autres sources',
        'av.timeline_partial':            'L’année {year} est incomplète — la collection s’arrête au {date}.',
        'av.timeline_undated':            '{count} enregistrements sans date de publication ne sont pas représentés.',

        'av.coverage_title':              'Informations disponibles dans le catalogue',
        'av.coverage_desc':               'Part des notices d’enregistrement dont chaque champ du catalogue est renseigné. Un champ rempli indique une information disponible, sans en évaluer l’exactitude ou la précision. Un champ vide n’établit pas que le contenu correspondant est absent de l’enregistrement.',
        'av.coverage_description':        'Description',
        'av.coverage_transcription':      'Transcription',
        'av.coverage_pub_date':           'Date de publication',
        'av.coverage_thumbnail':          'Image fixe',
        'av.coverage_language':           'Langue',
        'av.coverage_creator':            'Créateur',
        'av.coverage_subject':            'Sujet',
        'av.coverage_tip':                '{present} enregistrements sur {total} ({percent} %)',

        'av.recent_title':                'Les plus récents',
        'av.recent_desc':                 'Les enregistrements les plus récents de la collection.',
        'av.recent_watch':                'Regarder',
        'av.recent_open':                 'Ouvrir dans la collection'
    });
})();
