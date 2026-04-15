/**
 * IWAC Visualizations — JavaScript i18n
 *
 * Locale is resolved from <html lang="…">, which the IWAC theme populates via
 * Omeka's Internationalisation module. Language switching in IWAC is a page
 * navigation (full reload to a new locale URL), so there is no runtime switch —
 * translations just need to be read at render time.
 *
 * Usage:
 *   IWACVis.t('Loading dashboard')          // → "Loading dashboard" or "Chargement du tableau…"
 *   IWACVis.t('items', { count: 42 })       // interpolates {count}
 *
 * PHP-rendered strings (layout, blocks, etc.) use Omeka's $this->translate()
 * which reads from language/fr.mo — this file is only for strings rendered
 * client-side by the chart code.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    /* ----------------------------------------------------------------- */
    /*  Locale detection                                                  */
    /* ----------------------------------------------------------------- */

    /** Resolve the current locale from <html lang>, normalized to 2-letter code. */
    function detectLocale() {
        var raw = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
        // Accept "en", "en-us", "en_US", "fr-FR" → "en" | "fr"
        var short = raw.split(/[-_]/)[0];
        return short === 'fr' ? 'fr' : 'en';
    }

    ns.locale = detectLocale();

    /* ----------------------------------------------------------------- */
    /*  Translation dictionary                                            */
    /* ----------------------------------------------------------------- */

    /**
     * Keys are English source strings (matching Omeka convention).
     * Add new keys here as the UI grows. Keep `en` values identical to the
     * key — they exist so `t()` can fall back gracefully.
     *
     * For pluralization and interpolation, use curly placeholders:
     *   'items_count': '{count} items'
     * and call with: t('items_count', { count: 42 })
     */
    var DICTIONARY = {
        en: {
            // UI chrome
            'Loading dashboard': 'Loading dashboard',
            'Loading knowledge graph': 'Loading knowledge graph',
            'Loading collection overview': 'Loading collection overview',
            'Loading project comparison': 'Loading project comparison',
            'Dashboard': 'Dashboard',
            'Visualizations': 'Visualizations',
            'Knowledge Graph': 'Knowledge Graph',
            'Toggle fullscreen': 'Toggle fullscreen',
            'Save as image': 'Save as image',
            'Download chart': 'Download chart',
            'Show patterns': 'Show patterns',
            'Hide patterns': 'Hide patterns',
            'No data available': 'No data available',
            'Failed to load': 'Failed to load',

            // Chart axis / tooltip
            'Count': 'Count',
            'Year': 'Year',
            'Total': 'Total',

            // Collection overview — summary labels
            'Articles': 'Articles',
            'Publications': 'Publications',
            'Documents': 'Documents',
            'Audiovisual': 'Audiovisual',
            'References': 'References',
            'Entities': 'Entities',
            'Countries': 'Countries',
            'Languages': 'Languages',
            'Words': 'Words',
            'Newspapers': 'Newspapers',
            'Unknown': 'Unknown',

            // Collection overview — chart titles
            'Items per year, by country': 'Items per year, by country',
            'Content by country': 'Content by country',
            'Languages represented': 'Languages represented',
            'Most-cited entities': 'Most-cited entities',
            'Newspaper coverage': 'Newspaper coverage',
            'Collection breakdown': 'Collection breakdown',
            'period_covered': 'Period covered: {min} – {max}',
            'coverage_range': '{min} – {max}',

            // Entity type tabs (must match INDEX_TYPES in the generator)
            'Persons': 'Persons',
            'Organizations': 'Organizations',
            'Places': 'Places',
            'Subjects': 'Subjects',
            'Events': 'Events',

            // References overview
            'Authors': 'Authors',
            'Publishers': 'Publishers',
            'Reference type': 'Reference type',
            'Reference types': 'Reference types',
            'References by type over time': 'References by type over time',
            'Top authors': 'Top authors',
            'Top subjects': 'Top subjects',
            'Languages studied': 'Languages',
            'Places studied': 'Places studied',
            'Fetching references…': 'Fetching references\u2026',

            // Reference type labels (values come from `o:resource_class` in French)
            'ref_type_Article de revue':    'Journal article',
            'ref_type_Chapitre':            'Book chapter',
            'ref_type_Livre':               'Book',
            'ref_type_Th\u00e8se':          'Thesis',
            'ref_type_M\u00e9moire':        'Master\u2019s thesis',
            'ref_type_Communication':       'Conference paper',
            'ref_type_Rapport':             'Report',
            'ref_type_Pr\u00e9sentation':   'Presentation',
            'ref_type_Compte rendu':        'Review',
            'ref_type_Article de journal':  'Newspaper article',
            'ref_type_Billet de blog':      'Blog post',
            'ref_type_Page web':            'Web page',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Unknown',

            // Plural-ish
            'items_count': '{count} items',
            'articles_count': '{count} articles',
            'publications_count': '{count} publications',
            'references_count': '{count} references',
            'mentions_count': '{count} mentions',

            // Collection overview v2 — summary cards
            'Index': 'Index',
            'Total words': 'Total words',
            'Total pages': 'Total pages',
            'Scanned pages': 'Scanned pages',
            'Unique sources': 'Unique sources',
            'Document types': 'Document types',
            'Audiovisual minutes': 'Audiovisual minutes',
            'References count': 'References',

            // Collection overview v2 — new chart titles
            'Recent additions': 'Recent additions',
            'Collection growth over time': 'Collection growth over time',
            'Items by type, over time': 'Items by type, over time',
            'French word cloud': 'French word cloud',
            'World map': 'World map',

            // Collection overview v2 — facet controls & misc UI
            'Global': 'Global',
            'By type': 'By type',
            'By country': 'By country',
            'By year': 'By year',
            'All countries': 'All countries',
            'All types': 'All types',
            'Country': 'Country',
            'Previous': 'Previous',
            'Next': 'Next',
            'Page': 'Page',
            'Title': 'Title',
            'Source': 'Source',
            'Type': 'Type',
            'Added': 'Added',
            'Month': 'Month',
            'Monthly': 'Monthly',
            'Cumulative': 'Cumulative',
            'Monthly additions': 'Monthly additions',
            'Cumulative total': 'Cumulative total',
            'No recent additions': 'No recent additions',
            'Loading': 'Loading',
            'unique words': 'unique words',
            'Map library unavailable': 'Map library unavailable',

            // Item type badges (labels match user's preferred wording for the dataset)
            'item_type_article':     'News article',
            'item_type_publication': 'Islamic periodical',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Audio-visual recording',
            'item_type_reference':   'Reference',

            // Person dashboard — labels + panels
            'Mentions': 'Mentions',
            'Total mentions': 'Total mentions',
            'All roles': 'All roles',
            'As subject': 'As subject',
            'As creator': 'As creator',
            'As editor': 'As editor',
            'Associated entities': 'Associated entities',
            'Associated locations': 'Associated locations',
            'Top newspapers': 'Top newspapers',
            'Countries covered': 'Countries covered',
            'Period covered_short': 'Years',
            'Distinctiveness score': 'Distinctiveness score',
            'Affiliations': 'Affiliations',
            'Wikidata': 'Wikidata',

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Articles, publications and references mentioning this person each year, stacked by country of publication.',
            'desc_top_newspapers':         'News and periodical sources where this person appears most often (top 15).',
            'desc_countries_covered':      'Distribution of mentions by country of publication of the source.',
            'desc_associated_entities':    'Top 50 co-occurring entities (persons, organisations, places, subjects, events) ranked by TF-IDF distinctiveness across the items where this person is named.',
            'desc_associated_locations':   'Geographic places mentioned in items where this person appears as creator or subject, drawn from each item\u2019s spatial coverage and from named-place tags joined to the IWAC authority list.',

            // New shared panels (person + entity)
            'Year × month heatmap':        'Year × month heatmap',
            'Top LDA topics':              'Top LDA topics',
            'AI sentiment':                'AI sentiment',
            'Subject co-occurrence':       'Subject co-occurrence',
            'desc_year_month_heatmap':     'Mention counts per year and month, drawn only from items with a parseable YYYY-MM date. Cells stay blank when no date can be resolved.',
            'desc_lda_topics':             'Top 12 LDA-30 topic labels for items mentioning this entity, by article count. Topics come from the precomputed LDA model on the articles subset; publications and references contribute to mention counts but not to the topic mix.',
            'desc_ai_sentiment':           'Polarity and centrality of articles mentioning this entity, with a side-by-side comparison of the three AI raters (Gemini, ChatGPT, Mistral). The model picker switches between them; the bars update in place. Articles only — publications and references are not rated.',
            'desc_subject_cooccurrence':   'Pairwise co-occurrence among the top 15 entities mentioned alongside this one. Distinct from the Associated entities network: that one is ego-centric (this entity at the centre), this one is pair-wise (which neighbours always travel together?).',

            // AI sentiment — model + axis labels
            'Gemini':       'Gemini',
            'ChatGPT':      'ChatGPT',
            'Mistral':      'Mistral',
            'Polarity':     'Polarity',
            'Centrality':   'Centrality',
            'Subjectivity': 'Subjectivity',

            // AI sentiment — polarité category labels (data uses raw
            // French as the key; English locale maps them here while
            // CSS palette lookups continue to use the French keys).
            'Très positif':   'Very positive',
            'Positif':        'Positive',
            'Neutre':         'Neutral',
            'Négatif':        'Negative',
            'Très négatif':   'Very negative',
            'Non applicable': 'Not applicable',

            // AI sentiment — centralité category labels
            'Très central': 'Very central',
            'Central':      'Central',
            'Secondaire':   'Secondary',
            'Marginal':     'Marginal',
            'Non abordé':   'Not addressed',

            // AI sentiment — subjectivité bucket labels (1 = objective → 5 = very subjective)
            '1': 'Very objective',
            '2': 'Rather objective',
            '3': 'Mixed',
            '4': 'Rather subjective',
            '5': 'Very subjective',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Articles, publications and references mentioning this entity each year, stacked by country of publication.',
            'desc_entity_top_newspapers':       'News and periodical sources where this entity is named most often (top 15).',
            'desc_entity_countries_covered':    'Distribution of mentions by country of publication of the source.',
            'desc_entity_associated_entities':  'Top 50 co-occurring entities (persons, organisations, places, subjects, events) ranked by TF-IDF distinctiveness across the items where this entity is named.',
            'desc_entity_associated_locations': 'Geographic places mentioned in the same items as this entity, drawn from each item\u2019s spatial coverage and from named-place tags joined to the IWAC authority list.',

            // Network panel toolbar
            'Zoom in': 'Zoom in',
            'Zoom out': 'Zoom out',
            'Reset view': 'Reset view',
            'Toggle legend': 'Toggle legend',
            'Toggle fullscreen': 'Toggle fullscreen',

            // Entity type labels (used by C.network legend + tooltips)
            'entity_type_center': 'Center',
            'entity_type_Personnes': 'Persons',
            'entity_type_Organisations': 'Organizations',
            'entity_type_Lieux': 'Places',
            'entity_type_Sujets': 'Subjects',
            'entity_type_\u00c9v\u00e9nements': 'Events',

            // Index overview — block + section labels
            'Loading index overview':    'Loading index overview',
            'Entity Index Explorer':     'Entity Index Explorer',
            'Keyword Explorer':          'Keyword Explorer',
            'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
                'Prevalence of Dublin Core Subject and Spatial Coverage tags over time. Counts reflect item-level tagging, not text occurrence: an item tagged "Terrorism" contributes one mention to that year, no matter how many times the word appears in the body.',

            // Index overview — Section A panel titles
            'Entities by type':          'Entities by type',
            'Top entities':              'Most frequent entities in Dublin Core Subject and Spatial Coverage',
            'Lifespan \u00d7 frequency': 'Lifespan \u00d7 frequency',
            'Places map':                'Places map',
            'Temporal extent':           'Temporal extent',
            'Index table':               'Index table',

            // Index overview — Section A panel descriptions
            'desc_top_entities':   'Authority records that appear most often in item-level Dublin Core Subject (dcterms:subject) and Spatial Coverage (dcterms:spatial) fields. Click a bar to open the entity\u2019s page.',
            'desc_lifespan':       'Each point is one entity: horizontal axis is the span in years between its first and last occurrence, vertical axis is its total mention count, color encodes entity type. Click a point to open the entity.',
            'desc_temporal_extent': 'First and last year each top entity appears in the corpus (up to 30 per type, ranked by frequency). Each bar spans from earliest to latest mention.',
            'desc_places_map':     'Two complementary layers on the same map. Authority pins: every place in the IWAC authority index that has geographic coordinates. Mention bubbles: how often each place is tagged in an item\u2019s Dublin Core Spatial Coverage field, joined back to the authority pin by name. Click a pin to open the place\u2019s page.',

            // Index overview — summary cards + scatter axes
            'Total entities':            'Total entities',
            'With coordinates':          'With coordinates',
            'Span (years)':              'Span (years)',
            'Frequency':                 'Frequency',

            // Index overview — map layer facets + index table search
            'Both layers':               'Both layers',
            'Authority pins':            'Authority pins',
            'Layer':                     'Layer',
            'Search entities':           'Search entities',

            // Keyword Explorer — filters + tabs
            'Spatial Coverage':          'Spatial Coverage',
            'Field':                     'Field',
            'Facet by':                  'Facet by',
            'By newspaper':              'By newspaper',
            'Newspaper':                 'Newspaper',
            'All newspapers':            'All newspapers',
            'View mode':                 'View mode',
            'Top frequent':              'Top frequent',
            'Compare':                   'Compare',
            'top_n_keywords':            '{count} keywords',
            'Number to show':            'Number to show',
            'select_up_to_n':            'Select up to {count} keywords',
            'Search keywords':           'Search keywords',
            'No keywords selected':      'No keywords selected',
            'Clear selection':           'Clear selection',

            // Keyword Explorer — chart + table
            'Keywords over time':        'Keywords over time',
            'All keywords':              'All keywords',
            'Keyword':                   'Keyword',
            'Occurrences':               'Occurrences',
            'Add':                       'Add',
            'Remove':                    'Remove',
            'top_n_over_time':           'Top {count} keywords over time',
            'Keyword comparison':        'Keyword comparison',
            'Filtered by country: {country}':     'Filtered by country: {country}',
            'Filtered by newspaper: {newspaper}': 'Filtered by newspaper: {newspaper}',
            'All data (global)':         'All data (global)',
            'Select keywords to compare': 'Select keywords to compare',
        },
        fr: {
            'Loading dashboard': 'Chargement du tableau de bord',
            'Loading knowledge graph': 'Chargement du graphe de connaissances',
            'Loading collection overview': 'Chargement de la vue d\u2019ensemble',
            'Loading project comparison': 'Chargement de la comparaison',
            'Dashboard': 'Tableau de bord',
            'Visualizations': 'Visualisations',
            'Knowledge Graph': 'Graphe de connaissances',
            'Toggle fullscreen': 'Basculer en plein \u00e9cran',
            'Save as image': 'Enregistrer comme image',
            'Download chart': 'T\u00e9l\u00e9charger le graphique',
            'Show patterns': 'Afficher les motifs',
            'Hide patterns': 'Masquer les motifs',
            'No data available': 'Aucune donn\u00e9e disponible',
            'Failed to load': 'Le chargement a \u00e9chou\u00e9',

            'Count': 'Nombre',
            'Year': 'Ann\u00e9e',
            'Total': 'Total',

            // Collection overview — summary labels
            'Articles': 'Articles',
            'Publications': 'Publications',
            'Documents': 'Documents',
            'Audiovisual': 'Audiovisuel',
            'References': 'R\u00e9f\u00e9rences',
            'Entities': 'Entit\u00e9s',
            'Countries': 'Pays',
            'Languages': 'Langues',
            'Words': 'Mots',
            'Newspapers': 'Journaux',
            'Unknown': 'Inconnu',

            // Collection overview — chart titles
            'Items per year, by country': '\u00c9l\u00e9ments par ann\u00e9e, par pays',
            'Content by country': 'Contenu par pays',
            'Languages represented': 'Langues repr\u00e9sent\u00e9es',
            'Most-cited entities': 'Entit\u00e9s les plus cit\u00e9es',
            'Newspaper coverage': 'Couverture des journaux',
            'Collection breakdown': 'R\u00e9partition de la collection',
            'period_covered': 'P\u00e9riode couverte : {min} \u2013 {max}',
            'coverage_range': '{min} \u2013 {max}',

            // Entity type tabs
            'Persons': 'Personnes',
            'Organizations': 'Organisations',
            'Places': 'Lieux',
            'Subjects': 'Sujets',
            'Events': '\u00c9v\u00e9nements',

            // References overview
            'Authors': 'Auteurs',
            'Publishers': 'Éditeurs',
            'Reference type': 'Type de r\u00e9f\u00e9rence',
            'Reference types': 'Types de r\u00e9f\u00e9rence',
            'References by type over time': 'R\u00e9f\u00e9rences par type dans le temps',
            'Top authors': 'Auteurs les plus cit\u00e9s',
            'Top subjects': 'Sujets r\u00e9currents',
            'Languages studied': 'Langues',
            'Places studied': 'Lieux \u00e9tudi\u00e9s',
            'Fetching references…': 'R\u00e9cup\u00e9ration des r\u00e9f\u00e9rences\u2026',

            // Reference type labels — already French from the dataset, pass-through
            'ref_type_Article de revue':    'Article de revue',
            'ref_type_Chapitre':            'Chapitre',
            'ref_type_Livre':               'Livre',
            'ref_type_Th\u00e8se':          'Th\u00e8se',
            'ref_type_M\u00e9moire':        'M\u00e9moire',
            'ref_type_Communication':       'Communication',
            'ref_type_Rapport':             'Rapport',
            'ref_type_Pr\u00e9sentation':   'Pr\u00e9sentation',
            'ref_type_Compte rendu':        'Compte rendu',
            'ref_type_Article de journal':  'Article de journal',
            'ref_type_Billet de blog':      'Billet de blog',
            'ref_type_Page web':            'Page web',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Inconnu',

            'items_count': '{count} \u00e9l\u00e9ments',
            'articles_count': '{count} articles',
            'publications_count': '{count} publications',
            'references_count': '{count} r\u00e9f\u00e9rences',
            'mentions_count': '{count} mentions',

            // Collection overview v2 — summary cards
            'Index': 'Index',
            'Total words': 'Mots totaux',
            'Total pages': 'Pages totales',
            'Scanned pages': 'Pages num\u00e9ris\u00e9es',
            'Unique sources': 'Sources uniques',
            'Document types': 'Types de documents',
            'Audiovisual minutes': 'Minutes audiovisuelles',
            'References count': 'R\u00e9f\u00e9rences',

            // Collection overview v2 — new chart titles
            'Recent additions': 'Ajouts r\u00e9cents',
            'Collection growth over time': 'Croissance de la collection dans le temps',
            'Items by type, over time': '\u00c9l\u00e9ments par type, dans le temps',
            'French word cloud': 'Nuage de mots fran\u00e7ais',
            'World map': 'Carte du monde',

            // Collection overview v2 — facet controls & misc UI
            'Global': 'Global',
            'By type': 'Par type',
            'By country': 'Par pays',
            'By year': 'Par ann\u00e9e',
            'All countries': 'Tous les pays',
            'All types': 'Tous les types',
            'Country': 'Pays',
            'Previous': 'Pr\u00e9c\u00e9dent',
            'Next': 'Suivant',
            'Page': 'Page',
            'Title': 'Titre',
            'Source': 'Source',
            'Type': 'Type',
            'Added': 'Ajout\u00e9',
            'Month': 'Mois',
            'Monthly': 'Mensuel',
            'Cumulative': 'Cumul\u00e9',
            'Monthly additions': 'Ajouts mensuels',
            'Cumulative total': 'Total cumul\u00e9',
            'No recent additions': 'Aucun ajout r\u00e9cent',
            'Loading': 'Chargement',
            'unique words': 'mots uniques',
            'Map library unavailable': 'Biblioth\u00e8que de cartographie indisponible',

            // Item type badges (user's preferred French labels)
            'item_type_article':     'Article de presse',
            'item_type_publication': 'P\u00e9riodique islamique',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Enregistrement audio-visuel',
            'item_type_reference':   'R\u00e9f\u00e9rence',

            // Person dashboard — labels + panels
            'Mentions': 'Mentions',
            'Total mentions': 'Mentions totales',
            'All roles': 'Tous les r\u00f4les',
            'As subject': 'Comme sujet',
            'As creator': 'Comme cr\u00e9ateur',
            'As editor': 'Comme \u00e9diteur',
            'Associated entities': 'Entit\u00e9s associ\u00e9es',
            'Associated locations': 'Lieux associ\u00e9s',
            'Top newspapers': 'Journaux les plus fr\u00e9quents',
            'Countries covered': 'Pays couverts',
            'Period covered_short': 'Ann\u00e9es',
            'Distinctiveness score': 'Indice de sp\u00e9cificit\u00e9',
            'Affiliations': 'Affiliations',
            'Wikidata': 'Wikidata',

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Nombre d\u2019articles, publications et r\u00e9f\u00e9rences mentionnant cette personne par ann\u00e9e, empil\u00e9 par pays de publication.',
            'desc_top_newspapers':         'Journaux et p\u00e9riodiques o\u00f9 cette personne appara\u00eet le plus souvent (top 15).',
            'desc_countries_covered':      'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_associated_entities':    'Top 50 des entit\u00e9s co-occurrentes (personnes, organisations, lieux, sujets, \u00e9v\u00e9nements) class\u00e9es par score TF-IDF dans les notices o\u00f9 cette personne est nomm\u00e9e.',
            'desc_associated_locations':   'Lieux g\u00e9ographiques mentionn\u00e9s dans les notices o\u00f9 cette personne appara\u00eet comme cr\u00e9ateur ou sujet, extraits de la couverture spatiale et des balises de lieux li\u00e9es \u00e0 la liste d\u2019autorit\u00e9 IWAC.',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Nombre d\u2019articles, publications et r\u00e9f\u00e9rences mentionnant cette entit\u00e9 par ann\u00e9e, empil\u00e9 par pays de publication.',
            'desc_entity_top_newspapers':       'Journaux et p\u00e9riodiques o\u00f9 cette entit\u00e9 est nomm\u00e9e le plus souvent (top 15).',
            'desc_entity_countries_covered':    'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_entity_associated_entities':  'Top 50 des entit\u00e9s co-occurrentes (personnes, organisations, lieux, sujets, \u00e9v\u00e9nements) class\u00e9es par score TF-IDF dans les notices o\u00f9 cette entit\u00e9 est nomm\u00e9e.',
            'desc_entity_associated_locations': 'Lieux g\u00e9ographiques mentionn\u00e9s dans les m\u00eames notices que cette entit\u00e9, extraits de la couverture spatiale et des balises de lieux li\u00e9es \u00e0 la liste d\u2019autorit\u00e9 IWAC.',

            // New shared panels (person + entity)
            'Year × month heatmap':        'Carte de chaleur ann\u00e9e \u00d7 mois',
            'Top LDA topics':              'Th\u00e8mes LDA principaux',
            'AI sentiment':                'Sentiment IA',
            'Subject co-occurrence':       'Co-occurrence de sujets',
            'desc_year_month_heatmap':     'Nombre de mentions par ann\u00e9e et par mois, calcul\u00e9 uniquement \u00e0 partir des notices dont la date AAAA-MM peut \u00eatre extraite. Les cellules restent vides quand la date n\u2019est pas r\u00e9solue.',
            'desc_lda_topics':             'Les 12 \u00e9tiquettes de th\u00e8mes LDA les plus fr\u00e9quentes pour les articles mentionnant cette entit\u00e9. Issu du mod\u00e8le LDA pr\u00e9calcul\u00e9 sur le sous-ensemble des articles ; publications et r\u00e9f\u00e9rences contribuent aux comptes de mentions mais pas au mix th\u00e9matique.',
            'desc_ai_sentiment':           'Polarit\u00e9 et centralit\u00e9 des articles mentionnant cette entit\u00e9, avec comparaison des trois mod\u00e8les IA (Gemini, ChatGPT, Mistral). Le s\u00e9lecteur de mod\u00e8le bascule entre eux ; les barres se mettent \u00e0 jour sur place. Articles uniquement — publications et r\u00e9f\u00e9rences ne sont pas \u00e9valu\u00e9es.',
            'desc_subject_cooccurrence':   'Co-occurrence par paires parmi les 15 entit\u00e9s les plus mentionn\u00e9es aux c\u00f4t\u00e9s de celle-ci. Distinct du panneau Entit\u00e9s associ\u00e9es : celui-l\u00e0 est centr\u00e9 sur l\u2019entit\u00e9 (poids = TF-IDF vers le centre), celui-ci est par paires (quels voisins voyagent toujours ensemble ?).',

            // AI sentiment — model + axis labels
            'Gemini':       'Gemini',
            'ChatGPT':      'ChatGPT',
            'Mistral':      'Mistral',
            'Polarity':     'Polarit\u00e9',
            'Centrality':   'Centralit\u00e9',
            'Subjectivity': 'Subjectivit\u00e9',

            // AI sentiment — polarité category labels (pass-through in fr)
            'Très positif':   'Tr\u00e8s positif',
            'Positif':        'Positif',
            'Neutre':         'Neutre',
            'Négatif':        'N\u00e9gatif',
            'Très négatif':   'Tr\u00e8s n\u00e9gatif',
            'Non applicable': 'Non applicable',

            // AI sentiment — centralité category labels (pass-through in fr)
            'Très central': 'Tr\u00e8s central',
            'Central':      'Central',
            'Secondaire':   'Secondaire',
            'Marginal':     'Marginal',
            'Non abordé':   'Non abord\u00e9',

            // AI sentiment — subjectivité bucket labels (1..5)
            '1': 'Tr\u00e8s objectif',
            '2': 'Plut\u00f4t objectif',
            '3': 'Mixte',
            '4': 'Plut\u00f4t subjectif',
            '5': 'Tr\u00e8s subjectif',

            // Network panel toolbar
            'Zoom in': 'Zoom avant',
            'Zoom out': 'Zoom arri\u00e8re',
            'Reset view': 'R\u00e9initialiser la vue',
            'Toggle legend': 'Afficher/masquer la l\u00e9gende',
            'Toggle fullscreen': 'Basculer en plein \u00e9cran',

            // Entity type labels (used by C.network legend + tooltips)
            'entity_type_center': 'Centre',
            'entity_type_Personnes': 'Personnes',
            'entity_type_Organisations': 'Organisations',
            'entity_type_Lieux': 'Lieux',
            'entity_type_Sujets': 'Sujets',
            'entity_type_\u00c9v\u00e9nements': '\u00c9v\u00e9nements',

            // Index overview — block + section labels
            'Loading index overview':    'Chargement de la vue d\u2019ensemble de l\u2019index',
            'Entity Index Explorer':     'Explorateur d\u2019entit\u00e9s',
            'Keyword Explorer':          'Explorateur de mots-cl\u00e9s',
            'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
                'Pr\u00e9valence des indexations Dublin Core Sujet et Couverture spatiale dans le temps. Les comptes refl\u00e8tent l\u2019indexation au niveau de la notice, pas l\u2019occurrence dans le texte : une notice index\u00e9e \u00ab Terrorisme \u00bb compte pour une seule mention cette ann\u00e9e-l\u00e0, peu importe combien de fois le mot appara\u00eet dans le corps du texte.',

            // Index overview — Section A panel titles
            'Entities by type':          'Entit\u00e9s par type',
            'Top entities':              'Entit\u00e9s les plus fr\u00e9quentes dans les champs Sujet et Couverture spatiale (Dublin Core)',
            'Lifespan \u00d7 frequency': 'Dur\u00e9e de vie \u00d7 fr\u00e9quence',
            'Places map':                'Carte des lieux',
            'Temporal extent':           '\u00c9tendue temporelle',
            'Index table':               'Table de l\u2019index',

            // Index overview — Section A panel descriptions
            'desc_top_entities':   'Notices d\u2019autorit\u00e9 apparaissant le plus souvent dans les champs Dublin Core Sujet (dcterms:subject) et Couverture spatiale (dcterms:spatial) des notices de la collection. Cliquez sur une barre pour ouvrir la fiche de l\u2019entit\u00e9.',
            'desc_lifespan':       'Chaque point est une entit\u00e9 : l\u2019axe horizontal donne l\u2019\u00e9tendue en ann\u00e9es entre sa premi\u00e8re et sa derni\u00e8re mention, l\u2019axe vertical son nombre total de mentions, la couleur le type. Cliquez sur un point pour ouvrir la fiche.',
            'desc_temporal_extent': 'Premi\u00e8re et derni\u00e8re ann\u00e9e d\u2019apparition de chaque entit\u00e9 dans le corpus (jusqu\u2019\u00e0 30 par type, class\u00e9es par fr\u00e9quence). Chaque barre va de la mention la plus ancienne \u00e0 la plus r\u00e9cente.',
            'desc_places_map':     'Deux couches compl\u00e9mentaires sur la m\u00eame carte. Points d\u2019autorit\u00e9 : chaque lieu de l\u2019index IWAC ayant des coordonn\u00e9es. Bulles de mentions : fr\u00e9quence avec laquelle chaque lieu est indiqu\u00e9 dans le champ Dublin Core Couverture spatiale des notices, joint \u00e0 son point d\u2019autorit\u00e9 par le nom. Cliquez sur un point pour ouvrir la fiche du lieu.',

            // Index overview — summary cards + scatter axes
            'Total entities':            'Entit\u00e9s au total',
            'With coordinates':          'Avec coordonn\u00e9es',
            'Span (years)':              'Dur\u00e9e (ann\u00e9es)',
            'Frequency':                 'Fr\u00e9quence',

            // Index overview — map layer facets + index table search
            'Both layers':               'Les deux couches',
            'Authority pins':            'Points d\u2019autorit\u00e9',
            'Layer':                     'Couche',
            'Search entities':           'Rechercher des entit\u00e9s',

            // Keyword Explorer — filters + tabs
            'Spatial Coverage':          'Couverture spatiale',
            'Field':                     'Champ',
            'Facet by':                  'Filtrer par',
            'By newspaper':              'Par journal',
            'Newspaper':                 'Journal',
            'All newspapers':            'Tous les journaux',
            'View mode':                 'Mode d\u2019affichage',
            'Top frequent':              'Plus fr\u00e9quents',
            'Compare':                   'Comparer',
            'top_n_keywords':            '{count} mots-cl\u00e9s',
            'Number to show':            'Nombre \u00e0 afficher',
            'select_up_to_n':            'S\u00e9lectionnez jusqu\u2019\u00e0 {count} mots-cl\u00e9s',
            'Search keywords':           'Rechercher des mots-cl\u00e9s',
            'No keywords selected':      'Aucun mot-cl\u00e9 s\u00e9lectionn\u00e9',
            'Clear selection':           'Effacer la s\u00e9lection',

            // Keyword Explorer — chart + table
            'Keywords over time':        'Mots-cl\u00e9s dans le temps',
            'All keywords':              'Tous les mots-cl\u00e9s',
            'Keyword':                   'Mot-cl\u00e9',
            'Occurrences':               'Occurrences',
            'Add':                       'Ajouter',
            'Remove':                    'Retirer',
            'top_n_over_time':           'Top {count} mots-cl\u00e9s dans le temps',
            'Keyword comparison':        'Comparaison de mots-cl\u00e9s',
            'Filtered by country: {country}':     'Filtr\u00e9 par pays : {country}',
            'Filtered by newspaper: {newspaper}': 'Filtr\u00e9 par journal : {newspaper}',
            'All data (global)':         'Toutes les donn\u00e9es (global)',
            'Select keywords to compare': 'S\u00e9lectionnez des mots-cl\u00e9s \u00e0 comparer',
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Public API                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Translate a key. Falls back to the key itself (which is the English
     * source string) when no translation is registered.
     *
     * @param {string} key
     * @param {Object} [params] Values for {placeholder} interpolation
     * @returns {string}
     */
    ns.t = function (key, params) {
        var table = DICTIONARY[ns.locale] || DICTIONARY.en;
        var str = table[key] || (DICTIONARY.en[key] !== undefined ? DICTIONARY.en[key] : key);
        if (params) {
            str = str.replace(/\{(\w+)\}/g, function (_, name) {
                return params[name] != null ? params[name] : '{' + name + '}';
            });
        }
        return str;
    };

    /** Format an integer according to the current locale (thousands separators). */
    ns.formatNumber = function (n) {
        if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
            try { return new Intl.NumberFormat(ns.locale === 'fr' ? 'fr-FR' : 'en-US').format(n); }
            catch (e) { /* fall through */ }
        }
        return String(n);
    };

    /** Extend the dictionary at runtime (for strings added by individual charts). */
    ns.addTranslations = function (locale, entries) {
        if (!DICTIONARY[locale]) DICTIONARY[locale] = {};
        Object.keys(entries).forEach(function (k) {
            DICTIONARY[locale][k] = entries[k];
        });
    };
})();
