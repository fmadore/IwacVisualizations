/**
 * IWAC Visualizations — Sentiment Atlas block: i18n strings.
 *
 * Split out of sentiment-atlas.js so the orchestrator carries logic, not a
 * ~110-line translation table. Registers the block's en/fr strings into the
 * shared dictionary at parse time; loaded before the orchestrator (which
 * reads them via P.t('sentiment.*')).
 *
 * The raw rating labels ('Très positif', 'Non abordé', …) already live in
 * the shared dictionary — P.t(label) translates them on the English site
 * and passes them through on the French one.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) {
        return;
    }

        ns.addTranslations('en', {
            'sentiment.rated_by':               'Rated by {model}',
            'sentiment.ai_note':                'Each AI model assessed the articles independently. Polarity describes the tone towards Islam and Muslims; centrality describes their prominence in the article; subjectivity describes the model’s assessment of factual or opinion-based language. These ratings support exploration and need checking against the texts. Model agreement is not a measure of accuracy.',
            'sentiment.sec_time':               'Ratings over time',
            'sentiment.sec_breakdown':          'How the ratings break down',
            'sentiment.sec_extremes':           'Subjects associated with high and low ratings',
            'sentiment.sec_compare':            'Model comparison',
            'sentiment.polarity_year_title':    'Polarity over time',
            'sentiment.polarity_year_desc':     'Articles published each year, stacked by the polarity the selected model assigned, from very positive to very negative. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.centrality_year_title':  'Centrality of Islam over time',
            'sentiment.centrality_year_desc':   'Articles published each year, stacked by how central Islam and Muslims are to the article according to the selected model, from very central to not addressed.',
            'sentiment.polarity_country_title': 'Polarity by country',
            'sentiment.polarity_country_desc':  'Total polarity ratings by country of publication for the selected model. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.polarity_topic_title':   'Polarity by topic',
            // {count}: the bundle's topics. Interpolated, because the copy said "30"
            // whatever the model was refit with.
            'sentiment.polarity_topic_desc':    'Each of the {count} topics found by the statistical model as a share of its own rated articles, negative ratings running left of the centre line and positive ratings right, with neutral ones straddling it. The article count on the right is what each share is calculated on. Topic names show their two leading words; hover for the full term list. “Not applicable” is excluded.',
            'sentiment.polarity_topic_desc_one': 'The one topic found by the statistical model as a share of its own rated articles, negative ratings running left of the centre line and positive ratings right, with neutral ones straddling it. The article count on the right is what each share is calculated on. The topic name shows its two leading words; hover for the full term list. “Not applicable” is excluded.',
            'sentiment.polarity_newspaper_title': 'Polarity by newspaper',
            'sentiment.polarity_newspaper_desc':  'Each newspaper with at least {min} rated articles as a share of its own coverage, negative ratings running left of the centre line and positive ratings right, with neutral ones straddling it. The article count on the right is what each share is calculated on. “Not applicable” is excluded.',
            'sentiment.sort_by':                'Order',
            'sentiment.sort_polarity':          'Most positive first',
            'sentiment.sort_volume':            'Most articles first',
            'sentiment.rated_n':                '{count} rated articles',
            'sentiment.rated_n_one':            '{count} rated article',
            'sentiment.subjectivity_title':     'Subjectivity trend',
            'sentiment.subjectivity_desc':      'Average of the available subjectivity ratings for each publication year and model. Categories are coded from 1 (very objective) to 5 (very subjective); averaging assumes equal steps between them. Models disagree substantially on this measure, so small differences and apparent trends require particular caution.',
            'sentiment.correlation_title':      'Polarity against subjectivity',
            'sentiment.correlation_desc':       'Polarity ratings grouped by the selected model’s subjectivity categories, from 1 (very objective) to 5 (very subjective). Use this view to explore how the two ratings coincide. Subjectivity is particularly uncertain, and the pattern does not establish a causal relationship. “Not applicable” is excluded.',
            'sentiment.cenheat_title':          'Centrality by country and year',
            'sentiment.cenheat_desc':           'Average centrality rating by country of publication and year. Categories are coded from 1 (not addressed) to 5 (very central), with equal steps assumed for the average. Darker cells indicate greater prominence of Islam and Muslims according to the selected model. Empty cells have no rated articles.',
            'sentiment.cenheat_tip':            '{country} · {year}<br>Mean centrality {value} (n = {count})',
            'sentiment.extremes_title':         'Keywords in articles with high or low ratings',
            'sentiment.extremes_desc':          'The most frequent catalogue subjects and places among articles in the selected rating group. These tags help identify material to read alongside the model’s assessment. A high or low rating describes the model’s classification, not the extremism of an article or its subjects.',
            'sentiment.extremes_category':      'Rating group',
            'sentiment.extremes_type':          'Keywords',
            'sentiment.extremes_n':             '{count} articles in this rating group for the selected model.',
            'sentiment.kw_subject':             'Subjects',
            'sentiment.kw_spatial':             'Places',
            'sentiment.cat_subjectivity_high':      'Most subjective (4–5)',
            'sentiment.cat_subjectivity_low':       'Most objective (1–2)',
            'sentiment.cat_polarity_very_negative': 'Very negative',
            'sentiment.cat_polarity_very_positive': 'Very positive',
            'sentiment.cat_centrality_very_central':'Most central',
            'sentiment.cat_centrality_marginal':    'Marginal',
            'sentiment.agreement_title':        'Cross-model agreement',
            'sentiment.agreement_desc':         'The share of articles rated by both models where the two assign the same polarity label, with the full label-by-label table for the selected pair.',
            'sentiment.na_note':                '{count} articles rated “Not applicable” by this model are excluded from the polarity stacks.',
            'sentiment.co_rated':               '{count} co-rated articles',
            'sentiment.co_rated_one':           '{count} co-rated article',
            'sentiment.pct_value':              '{pct}%',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Rows: {a} · Columns: {b}',
            'sentiment.pair_cell':              '{a}: {la} · {b}: {lb} — {count} articles'
        });
        ns.addTranslations('fr', {
            'sentiment.rated_by':               'Évalués par {model}',
            'sentiment.ai_note':                'Chaque modèle d’IA a évalué les articles séparément. La polarité décrit le ton envers l’islam et les musulmans\u202f; la centralité, la place qui leur est accordée\u202f; la subjectivité, l’appréciation par le modèle d’un langage factuel ou fondé sur des opinions. Ces évaluations facilitent l’exploration et doivent être confrontées aux textes. L’accord entre modèles ne mesure pas leur exactitude.',
            'sentiment.sec_time':               'Évaluations au fil du temps',
            'sentiment.sec_breakdown':          'Répartition des évaluations',
            'sentiment.sec_extremes':           'Sujets associés aux évaluations hautes et basses',
            'sentiment.sec_compare':            'Comparaison des modèles',
            'sentiment.polarity_year_title':    'Polarité au fil du temps',
            'sentiment.polarity_year_desc':     'Articles publiés chaque année, empilés selon la polarité attribuée par le modèle sélectionné, de très positif à très négatif. Les articles évalués «\u00a0Non applicable\u00a0» sont exclus des barres.',
            'sentiment.centrality_year_title':  'Centralité de l’islam au fil du temps',
            'sentiment.centrality_year_desc':   'Articles publiés chaque année, empilés selon la centralité de l’islam et des musulmans dans l’article d’après le modèle sélectionné, de très central à non abordé.',
            'sentiment.polarity_country_title': 'Polarité par pays',
            'sentiment.polarity_country_desc':  'Totaux des polarités par pays de publication pour le modèle sélectionné. Les articles évalués «\u00a0Non applicable\u00a0» sont exclus des barres.',
            'sentiment.polarity_topic_title':   'Polarité par thème',
            'sentiment.polarity_topic_desc':    'Chacun des {count} thèmes dégagés par le modèle statistique, en part de ses propres articles notés\u00a0: les polarités négatives s’étendent à gauche de l’axe central, les positives à droite, les neutres à cheval sur celui-ci. Le nombre d’articles indiqué à droite est la base de calcul de chaque part. Les noms de thèmes affichent leurs deux mots principaux\u202f; survolez pour la liste complète. «\u00a0Non applicable\u00a0» est exclu.',
            'sentiment.polarity_topic_desc_one': 'Le seul thème dégagé par le modèle statistique, en part de ses propres articles notés\u00a0: les polarités négatives s’étendent à gauche de l’axe central, les positives à droite, les neutres à cheval sur celui-ci. Le nombre d’articles indiqué à droite est la base de calcul de chaque part. Le nom du thème affiche ses deux mots principaux\u202f; survolez pour la liste complète. «\u00a0Non applicable\u00a0» est exclu.',
            'sentiment.polarity_newspaper_title': 'Polarité par journal',
            'sentiment.polarity_newspaper_desc':  'Chaque journal comptant au moins {min} articles notés, en part de sa propre couverture\u00a0: les polarités négatives s’étendent à gauche de l’axe central, les positives à droite, les neutres à cheval sur celui-ci. Le nombre d’articles indiqué à droite est la base de calcul de chaque part. «\u00a0Non applicable\u00a0» est exclu.',
            'sentiment.sort_by':                'Ordre',
            'sentiment.sort_polarity':          'Du plus positif',
            'sentiment.sort_volume':            'Du plus fourni',
            'sentiment.rated_n':                '{count} articles notés',
            'sentiment.rated_n_one':            '{count} article noté',
            'sentiment.subjectivity_title':     'Tendance de la subjectivité',
            'sentiment.subjectivity_desc':      'Moyenne des évaluations de subjectivité disponibles pour chaque année de publication et chaque modèle. Les catégories sont codées de 1 (très objectif) à 5 (très subjectif)\u202f; la moyenne suppose des écarts égaux entre elles. Les modèles divergent fortement sur cette mesure\u00a0: les petits écarts et les tendances apparentes demandent donc une prudence particulière.',
            'sentiment.correlation_title':      'Polarité et subjectivité',
            'sentiment.correlation_desc':       'Évaluations de polarité regroupées selon les catégories de subjectivité du modèle sélectionné, de 1 (très objectif) à 5 (très subjectif). Cette vue permet d’explorer les correspondances entre les deux évaluations. La subjectivité est particulièrement incertaine et le graphique n’établit pas de relation causale. «\u00a0Non applicable\u00a0» est exclu.',
            'sentiment.cenheat_title':          'Centralité par pays et par année',
            'sentiment.cenheat_desc':           'Évaluation moyenne de centralité par pays de publication et par année. Les catégories sont codées de 1 (non abordé) à 5 (très central), avec des écarts supposés égaux pour calculer la moyenne. Les cellules foncées indiquent une plus grande place de l’islam et des musulmans selon le modèle sélectionné. Les cellules vides ne comptent aucun article évalué.',
            'sentiment.cenheat_tip':            '{country} · {year}<br>Centralité moyenne {value} (n = {count})',
            'sentiment.extremes_title':         'Mots-clés des articles aux évaluations hautes ou basses',
            'sentiment.extremes_desc':          'Sujets et lieux du catalogue les plus fréquents parmi les articles du groupe d’évaluation sélectionné. Ces mots-clés aident à choisir des textes à lire pour examiner l’appréciation du modèle. Une évaluation haute ou basse décrit le classement du modèle, sans qualifier l’article ou ses sujets d’extrémistes.',
            'sentiment.extremes_category':      'Groupe d’évaluation',
            'sentiment.extremes_type':          'Mots-clés',
            'sentiment.extremes_n':             '{count} articles dans ce groupe d’évaluation pour le modèle sélectionné.',
            'sentiment.kw_subject':             'Sujets',
            'sentiment.kw_spatial':             'Lieux',
            'sentiment.cat_subjectivity_high':      'Plus subjectifs (4–5)',
            'sentiment.cat_subjectivity_low':       'Plus objectifs (1–2)',
            'sentiment.cat_polarity_very_negative': 'Très négatifs',
            'sentiment.cat_polarity_very_positive': 'Très positifs',
            'sentiment.cat_centrality_very_central':'Les plus centraux',
            'sentiment.cat_centrality_marginal':    'Marginaux',
            'sentiment.agreement_title':        'Accord entre modèles',
            'sentiment.agreement_desc':         'Part des articles co-évalués où deux modèles attribuent exactement la même polarité, avec le tableau croisé complet des étiquettes pour la paire sélectionnée.',
            'sentiment.na_note':                '{count} articles évalués «\u00a0Non applicable\u00a0» par ce modèle sont exclus des barres de polarité.',
            'sentiment.co_rated':               '{count} articles co-évalués',
            'sentiment.co_rated_one':           '{count} article co-évalué',
            'sentiment.pct_value':              '{pct}\u202f%',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Lignes\u00a0: {a} · Colonnes\u00a0: {b}',
            'sentiment.pair_cell':              '{a}\u00a0: {la} · {b}\u00a0: {lb} — {count} articles',
            'Model comparison':        'Comparaison des mod\u00e8les',
        });
})();
