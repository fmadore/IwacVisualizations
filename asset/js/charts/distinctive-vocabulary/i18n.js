/**
 * IWAC Visualizations — distinctive vocabulary block: translations.
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
        'Distinctive vocabulary':       'Distinctive vocabulary',
        'Coverage bursts':              'Coverage bursts',
        'keyness_title':                'Words that set this part of the collection apart',
        'keyness_desc':                 'Words whose rate of use is at least {ratio} times higher in this selection than in the remaining articles. Bar lengths use a logarithmic scale (base 2); labels give the rate multiplier. Words need at least {min} occurrences in the selection and pass a statistical test corrected for multiple comparisons (false-discovery rate threshold {alpha}). This identifies distinctive vocabulary, whose meaning needs checking in context.',
        'keyness_slice_caption':        '{slice}: {docs} articles, {tokens} words, {terms} distinctive terms.',
        'keyness_axis':                 'Times more frequent than elsewhere (log₂)',
        'keyness_tooltip_ratio':        'Used {ratio}× as often as in the rest of the collection',
        'keyness_tooltip_count':        '{count} occurrences in {slice}',
        'keyness_tooltip_stats':        'Log-likelihood G² {g2}, corrected p {q}',
        'bursts_title':                 'When coverage of a subject surged',
        'bursts_desc':                  'Periods when the share of articles carrying a subject tag rose above its usual rate. The detection model uses a rate multiplier of {s}; each bar marks one detected episode. Subjects need at least {min} tagged articles to be considered. The initial period of a tag’s use is excluded. These episodes may reflect changes in coverage, cataloguing or the material collected.',
        'bursts_caption':               '{bursts} episodes across {subjects} subjects ({found} of {tested} tested subjects burst at all).',
        'bursts_tooltip_span':          'Burst: {start}–{end}',
        'bursts_tooltip_mentions':      '{mentions} of the subject’s {total} articles fall in this burst',
        'bursts_tooltip_weight':        'Burst strength {weight}',
    });

    ns.addTranslations('fr', {
        'Distinctive vocabulary':       'Vocabulaire distinctif',
        'Coverage bursts':              'Pics de couverture',
        'keyness_title':                'Les mots qui distinguent cette partie de la collection',
        'keyness_desc':                 'Mots dont la fréquence relative est au moins {ratio} fois plus élevée dans cette sélection que dans les autres articles. La longueur des barres suit une échelle logarithmique de base 2 ; les libellés donnent le multiplicateur de fréquence. Les mots doivent compter au moins {min} occurrences dans la sélection et satisfaire un test corrigé pour les comparaisons multiples (seuil de taux de fausses découvertes {alpha}). Ce vocabulaire distinctif doit être interprété en contexte.',
        'keyness_slice_caption':        '{slice} : {docs} articles, {tokens} mots, {terms} termes distinctifs.',
        'keyness_axis':                 'Fois plus fr\u00e9quent qu\u2019ailleurs (log\u2082)',
        'keyness_tooltip_ratio':        'Employ\u00e9 {ratio} fois plus souvent que dans le reste de la collection',
        'keyness_tooltip_count':        '{count} occurrences dans {slice}',
        'keyness_tooltip_stats':        'Log-vraisemblance G\u00b2 {g2}, p corrig\u00e9 {q}',
        'bursts_title':                 'Quand la couverture d\u2019un sujet s\u2019est intensifi\u00e9e',
        'bursts_desc':                  'Périodes où la part des articles portant un mot-clé de sujet dépasse son niveau habituel. Le modèle de détection utilise un multiplicateur de fréquence de {s} ; chaque barre marque un épisode détecté. Seuls les sujets associés à au moins {min} articles sont examinés. La période initiale d’usage d’un mot-clé est exclue. Ces épisodes peuvent refléter des changements de couverture, d’indexation ou de documents collectés.',
        'bursts_caption':               '{bursts} \u00e9pisodes r\u00e9partis sur {subjects} sujets ({found} sujets sur {tested} test\u00e9s pr\u00e9sentent au moins un pic).',
        'bursts_tooltip_span':          'Pic : {start}-{end}',
        'bursts_tooltip_mentions':      '{mentions} des {total} articles du sujet se situent dans ce pic',
        'bursts_tooltip_weight':        'Intensit\u00e9 du pic : {weight}',
    });
})();
