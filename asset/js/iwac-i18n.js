/**
 * IWAC Visualizations — JavaScript i18n
 *
 * Locale is resolved from <html lang="…">, which the IWAC theme populates via
 * Omeka's Internationalisation module. Language switching in IWAC is a page
 * navigation (full reload to a new locale URL), so there is no runtime switch —
 * translations just need to be read at render time.
 *
 * Usage:
 *   IWACVis.t('Download chart')             // → "Download chart" or "Télécharger le graphique"
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

    // The on-view loader decides the locale first, because it chooses which
    // per-locale bundle to fetch — and this file, inside that bundle, carries
    // only that locale's dictionary. Its choice wins so the two can never
    // disagree; a page without the loader (a fixture, a foreign embed)
    // detects its own.
    var lazy = window.IWACVisLazy;
    ns.locale = (lazy && (lazy.locale === 'en' || lazy.locale === 'fr')) ? lazy.locale : detectLocale();

    /* ----------------------------------------------------------------- */
    /*  Translation dictionary                                            */
    /* ----------------------------------------------------------------- */

    /**
     * Keys are English source strings (matching Omeka convention).
     * Add new keys here as the UI grows. Identity-valued English entries are
     * intentionally omitted because `t()` already falls back to the key; keep
     * only English entries whose rendered value differs from their key.
     *
     * For pluralization and interpolation, use curly placeholders:
     *   'items_count': '{count} items'
     * and call with: t('items_count', { count: 42 })
     */
    var DICTIONARY = {
        en: {
            'Top LDA topics': 'Most frequent modelled themes',
            'Logarithmic scale': 'Log scale (equal ratios)',
            'Year × month heatmap': 'Recorded items by year and month',
            'Spatial coverage': 'Places associated with the items',
            'Show choropleth': 'Shade areas by count',
            // UI chrome. The source key keeps the American spelling the call
            // sites already pass; the English value is what readers see.
            'Visualization data is not available yet.': 'The data for this visualisation has not been published yet.',

            // Word-cloud panels (publication + item-set dashboards, layout renderer)
            'desc_word_cloud': 'The most frequent words, sized by how often they appear.',

            // Year ranges (summary subtitles, tooltips)
            'period_covered': 'Period covered: {min} – {max}',
            'coverage_range': '{min} – {max}',

            // Aggregate runtime (P.formatTotalDuration). A SUM of runtimes,
            // not one item's — the h:mm:ss clock format belongs to a single
            // recording, and a total in it reads as a timestamp.
            'duration_hours': '{count} h',
            'duration_minutes': '{count} min',

            // Windowed charts — the "showing N of M" disclosure and its
            // escape control (P.buildWindowDisclosure). These are the helper's
            // defaults; a block that can name its rows better ("newspapers" rather
            // than "rows") keeps its own pair in its own dictionary —
            // `gantt_window_*` (collection overview), `activity_window_*` (index
            // overview), `periodicals.runs_window_*`.
            'window_note': 'Showing {shown} of {total} rows.',
            'window_all': 'Showing all {total} rows.',
            'window_show_all': 'Show all {total}',
            'window_show_top': 'Show first {shown}',

            // Chart text alternatives. ECharts generates its own summary
            // otherwise — up to 2,500 characters, truncated mid-list at "the
            // first 10 items", carrying literal NaN on the custom-series
            // charts, and always in English because the library has no idea
            // what locale the page is in. These replace it wholesale
            // (aria.label.description), so they are the ONLY thing a screen
            // reader gets: they have to name the chart and stop.
            'chart_aria_plain': '{title}: chart.',
            'chart_aria_single': '{title}: chart with {points} values.',
            'chart_aria_summary': '{title}: chart with {series} series and {points} values.',
            'chart_aria_zoom': 'Focus the chart and use the arrow keys to move the visible window.',

            // The semantic landscapes' facet control (references, articles, laïcité)
            'Color by': 'Colour by',

            // Reference type labels (values come from `o:resource_class` in French)
            'ref_type_Article de revue':    'Journal article',
            'ref_type_Chapitre':            'Book chapter',
            'ref_type_Livre':               'Book',
            'ref_type_Ouvrage collectif':   'Edited volume',
            'ref_type_Th\u00e8se':          'Thesis',
            'ref_type_M\u00e9moire':        'Master\u2019s thesis',
            'ref_type_Communication':       'Conference paper',
            'ref_type_Rapport':             'Report',
            'ref_type_Pr\u00e9sentation':   'Presentation',
            'ref_type_Compte rendu':        'Review',
            'ref_type_Article de journal':  'Newspaper article',
            'ref_type_Billet de blog':      'Blog post',
            'ref_type_Article de blog':     'Blog post',
            'ref_type_Page web':            'Web page',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Unknown',

            // Language labels (values come from `language` in the dataset, in French)
            'lang_Anglais':   'English',
            'lang_Fran\u00e7ais': 'French',
            'lang_Allemand':  'German',
            'lang_Italien':   'Italian',
            'lang_Espagnol':  'Spanish',
            'lang_Slov\u00e8ne': 'Slovenian',
            'lang_Arabe':     'Arabic',
            'lang_Portugais': 'Portuguese',
            'lang_N\u00e9erlandais': 'Dutch',

            // Plural-ish
            'items_count': '{count} items',
            'items_count_one': '{count} item',
            'items_count_other': '{count} items',
            'articles_count': '{count} articles',
            'articles_count_one': '{count} article',
            'articles_count_other': '{count} articles',
            'references_count': '{count} references',
            'references_count_one': '{count} reference',
            'references_count_other': '{count} references',
            'publications_count': '{count} publications',
            'publications_count_one': '{count} publication',
            'publications_count_other': '{count} publications',
            'mentions_count': '{count} mentions',
            'mentions_count_one': '{count} mention',
            'mentions_count_other': '{count} mentions',

            // Item type badges (labels match user's preferred wording for the dataset)
            'item_type_article':     'News article',
            'item_type_publication': 'Islamic periodical',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Audio-visual recording',
            'item_type_reference':   'Reference',
            'item_type_image':       'Photograph',

            // Document types as the collection-overview bundle SPELLS them.
            //
            // `generate_collection_overview.py::SUBSET_TO_DOC_TYPE` writes the
            // French label into the treemap's second level, and nothing
            // localized it — so the English site's "Collection breakdown"
            // printed "Article de presse" and "Périodique islamique" inside a
            // chart whose every other label was English, and whose own
            // dateline elsewhere on the page said "ARTICLE". The keys are the
            // raw French strings because that is the `P.translateKeyed`
            // convention already used for `ref_type_` and `lang_`: the
            // precomputed JSON ships the French label and the JS localizes it.
            // Keep them byte-identical to the generator's map.
            'doc_type_Article de presse':               'News article',
            'doc_type_Périodique islamique':       'Islamic periodical',
            'doc_type_Document':                        'Document',
            'doc_type_Enregistrement audio-visuel':     'Audio-visual recording',
            'doc_type_Photographie':                    'Photograph',

            // Person dashboard — labels + panels
            'Period covered_short': 'Years',

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Articles, periodical issues and references linked to this person in the catalogue, by publication year and country. Use the role filter to distinguish records about the person from records crediting them as creator or editor.',
            'desc_top_newspapers':         'News and periodical sources where this person appears most often (top 15).',
            'desc_countries_covered':      'Distribution of mentions by country of publication of the source.',
            'desc_associated_entities':    'People, organisations, places, subjects and events associated with this person in the catalogue. The TF-IDF ranking gives more weight to associations specific to this person and less to entries common across the collection. Switch between the network, ranked list and timeline. Connections reflect shared records and require interpretation through the sources.',
            'desc_associated_locations':   'Places recorded on items associated with this person as creator or subject. Locations come from catalogue place fields and matching place tags, so the map is not a record of the person’s travels.',

            // New shared panels (person + entity)
            'desc_year_month_heatmap':     'Linked items by publication year and month. Only items with at least a year and month in their recorded date are included. Darker cells indicate more items; gaps reflect the available dated records and do not establish an absence of historical activity.',
            'desc_lda_topics':             'The 12 most frequent modelled themes in articles linked to this record, ranked by article count. LDA is a statistical method that groups words used together into topics. These modelled themes differ from catalogue subject tags. Periodical issues and references are excluded from this panel.',
            // Names no raters. The picker directly above lists them, and
            // the roster changes — this sentence still named the retired
            // January 2026 models for a release after the panel moved on.
            'desc_ai_sentiment':           'AI assessments of articles linked to this record. Polarity describes the tone towards Islam and Muslims; centrality describes their prominence in the article. These are whole-article ratings, not assessments of the selected person or organisation. Choose a model to compare its results. Periodical issues and references are not rated.',
            'desc_subject_cooccurrence':   'Pairs among the 15 most frequently associated people, organisations, places, subjects or events. Each value counts items in which both members of a pair are recorded. A shared item establishes a catalogue association, not necessarily a social relationship.',

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
            'Secondaire':   'Secondary',
            'Non abordé':   'Not addressed',

            // AI sentiment — subjectivité bucket labels (1 = objective → 5 = very subjective)
            '1': 'Very objective',
            '2': 'Rather objective',
            '3': 'Mixed',
            '4': 'Rather subjective',
            '5': 'Very subjective',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Articles, periodical issues and references linked to this entry in the catalogue, by publication year and country. These counts reflect the collected and indexed material, not every mention in the original texts.',
            'desc_entity_top_newspapers':       'News and periodical sources where this entity is named most often (top 15).',
            'desc_entity_countries_covered':    'Distribution of mentions by country of publication of the source.',
            'desc_entity_associated_entities':  'People, organisations, places, subjects and events associated with this entry in the catalogue. The TF-IDF ranking gives more weight to associations specific to this entry and less to entries common across the collection. Switch between the network, ranked list and timeline. Connections reflect shared records and require interpretation through the sources.',
            'desc_entity_associated_locations': 'Places recorded on items associated with this entry. Locations come from catalogue place fields and matching place tags; a shared record does not establish an event or activity at that location.',

            // Network panel toolbar + canvas force graph.
            // English keys are their own value, so only the parameterised
            // templates need an entry here; the plain labels
            // ('Show all labels', 'Freeze the layout', …) fall through the
            // identity default and are translated in the fr table below.
            'shared_items_count': '{count} shared items',
            'shared_items_count_one': '{count} shared item',
            'shared_items_count_other': '{count} shared items',
            'connections_count':        '{formatted} connections',
            'connections_count_one':    '{formatted} connection',
            'connections_count_other':  '{formatted} connections',
            'and_n_more':         'and {count} more',
            'and_n_more_one':     'and {count} more',

            // Associated entities — three views, shared controls.
            'Network view': 'Network',
            'All entities': 'All',
            'shared_items_in_period': '{count} shared items, {period}',
            'shared_items_in_period_one': '{count} shared item, {period}',

            // Entity type labels (legend + tooltips of the entity graphs)
            'entity_type_center': 'Centre',
            'entity_type_Personnes': 'Persons',
            'entity_type_Organisations': 'Organisations',
            // Bare entity-type label used as a card/axis caption; the English
            // spelling has to be overridden because the call sites key on the
            // American form.
            'Organizations': 'Organisations',
            'entity_type_Lieux': 'Places',
            'entity_type_Sujets': 'Subjects',
            'entity_type_\u00c9v\u00e9nements': 'Events',
            'entity_type_article': 'Newspaper article',

            // Layout renderer (horizontal bar) and the LDA-topic legends
            'desc_horizontal_bar':          'Top values by count, ranked from highest to lowest.',
            'topic_other':                  'Other topics',

            // Shared renderer labels (calendar heatmap, chord, radar,
            // sibling sparkline, similar-items strip, sunburst, treemap)
            'desc_calendar_heatmap':    'Items by publication date. Darker cells indicate more items. Use the calendar controls to compare periods; missing or incomplete dates limit coverage.',
            'cal_view_month':           'By month',
            'cal_view_day':             'By day',
            'cal_view_hijri':           'By Hijri month',
            'cal_hijri_era':            'AH',
            'cal_month_note':           'One column per year, one row per calendar month.',
            'cal_day_note':             'One cell per day, one block per year. Useful for spotting the surge around a single event, at the cost of a lot of empty grid.',
            'cal_hijri_note':           'Publication dates converted to the Islamic calendar with the Umm al-Qura tables, so Ramadan and Dhu al-Hijja hold still as rows instead of drifting eleven days a year across the Gregorian grid. Month boundaries in West Africa were set by local moon sighting and often fell a day either side of the tabular date, so a cell at the very start or end of a month may belong to its neighbour.',
            'cal_skipped_note':         '{count} could not be converted and are not shown.',
            'cal_skipped_note_one':     '{count} could not be converted and is not shown.',
            'cal_hijri_coverage':       'Only a complete day-precision date converts to a lunar one, so this grid covers {shown} of the {total} mentions the Gregorian view shows.',
            'desc_chord':               'Links between the entities most often mentioned in this set, laid out in a circle. The thicker the ribbon, the more often the two are mentioned together. Only the 30 best-connected entities are drawn, so the diagram stays legible.',
            'desc_radar_profile':       'Compare measures along separate axes. Each axis has its own scale, so inspect the labels and values rather than treating the overall shape or area as a combined score.',
            'desc_sibling_sparkline':   'Activity over time for the parent collection, such as this article within its newspaper’s timeline. The dot marks the current item.',
            'desc_similar_items':       'Articles ranked by an AI comparison of their full texts. Matches below the chosen similarity threshold are hidden. Similarity suggests reading leads, but does not establish a shared argument or source.',
            'desc_sunburst':            'A breakdown by level, drawn as concentric rings. Each ring is one level, and the longer the arc, the higher the count.',
            'desc_treemap':             'A breakdown by level, drawn as nested rectangles. Click a rectangle to open it; the trail at the bottom leads back up.',

            // The panel toolbar's table view (shared/panel-toolbar.js)
            'table_rows_capped':         'Showing the first {shown} of {total} rows; the CSV has all of them.',
        },
        fr: {
            'Clear': 'Effacer',
            'Download chart': 'T\u00e9l\u00e9charger le graphique',
            // ECharts legend selector buttons (E15).
            'Show all': 'Tout afficher',
            'Invert selection': 'Inverser la sélection',
            // Map titles — MapLibre's `Map.Title` and the host's
            // aria-label, so a screen reader names the map (M8).
            'Copy embed code': 'Copier le code d\u2019int\u00e9gration',
            'Copied!': 'Copi\u00e9\u00a0!',
            'Copy link to this view': 'Copier le lien vers cette vue',
            'Link copied': 'Lien copi\u00e9',
            'View as table': 'Afficher en tableau',
            'Hide table': 'Masquer le tableau',
            'Download CSV': 'T\u00e9l\u00e9charger en CSV',
            'Series': 'S\u00e9rie',
            'Name': 'Nom',
            'Value': 'Valeur',
            'Category': 'Cat\u00e9gorie',
            'Place': 'Lieu',
            'table_rows_capped': 'Les {shown} premi\u00e8res lignes sur {total} sont affich\u00e9es ; le CSV les contient toutes.',
            'No data available': 'Aucune donn\u00e9e disponible',
            'Failed to load': 'Le chargement a \u00e9chou\u00e9',
            'Visualization data is not available yet.': 'Les donn\u00e9es de visualisation ne sont pas encore disponibles.',

            'Count': 'Nombre',
            'Year': 'Ann\u00e9e',
            'Total': 'Total',
            'Logarithmic scale': 'Échelle logarithmique (rapports égaux)',

            // Summary cards and table columns
            'Total items': 'Documents au total',
            'Articles': 'Articles',
            'Countries': 'Pays',
            'Languages': 'Langues',
            'Words': 'Mots',
            'Newspapers': 'Journaux',
            'Unknown': 'Inconnu',
            'Pages': 'Pages',
            'Language': 'Langue',
            'Date': 'Date',

            // Word-cloud panels
            'Word cloud': 'Nuage de mots',
            'desc_word_cloud': 'Les mots les plus fr\u00e9quents, dimensionn\u00e9s selon le nombre de leurs occurrences.',

            // Breakdown panels (collection + references overviews) and year ranges
            'Content by country': 'Contenu par pays',
            'Languages represented': 'Langues repr\u00e9sent\u00e9es',
            'Collection breakdown': 'R\u00e9partition de la collection',
            'period_covered': 'P\u00e9riode couverte : {min} \u2013 {max}',
            'coverage_range': '{min} \u2013 {max}',

            // Cumulative runtime (see the English block)
            'duration_hours': '{count} h',
            'duration_minutes': '{count} min',

            // Windowed charts (see the English block)
            'window_note': 'Affichage de {shown} lignes sur {total}.',
            'window_all': 'Affichage des {total} lignes.',
            'window_show_all': 'Afficher les {total}',
            'window_show_top': 'Afficher les {shown} premi\u00e8res',

            // Chart text alternatives
            'chart_aria_plain': '{title} : graphique.',
            'chart_aria_single': '{title} : graphique de {points} valeurs.',
            'chart_aria_summary': '{title} : graphique de {series} s\u00e9ries et {points} valeurs.',
            'chart_aria_zoom': 'Placez le focus sur le graphique et utilisez les touches fl\u00e9ch\u00e9es pour d\u00e9placer la fen\u00eatre visible.',
            'Chart': 'Graphique',
            'Filters': 'Filtres',

            // Entity type tabs
            'Persons': 'Personnes',
            'Organizations': 'Organisations',
            'Places': 'Lieux',
            'Subjects': 'Sujets',
            'Events': '\u00c9v\u00e9nements',

            'Authors': 'Auteurs',
            'Top subjects': 'Sujets r\u00e9currents',

            // Facette des paysages sémantiques
            'Color by': 'Colorer par',
            'Decade': 'Décennie',

            // Reference type labels — already French from the dataset, pass-through
            'ref_type_Article de revue':    'Article de revue',
            'ref_type_Chapitre':            'Chapitre',
            'ref_type_Livre':               'Livre',
            'ref_type_Ouvrage collectif':   'Ouvrage collectif',
            'ref_type_Th\u00e8se':          'Th\u00e8se',
            'ref_type_M\u00e9moire':        'M\u00e9moire',
            'ref_type_Communication':       'Communication',
            'ref_type_Rapport':             'Rapport',
            'ref_type_Pr\u00e9sentation':   'Pr\u00e9sentation',
            'ref_type_Compte rendu':        'Compte rendu',
            'ref_type_Article de journal':  'Article de journal',
            'ref_type_Billet de blog':      'Billet de blog',
            'ref_type_Article de blog':     'Article de blog',
            'ref_type_Page web':            'Page web',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Inconnu',

            // Language labels — French source, pass-through
            'lang_Anglais':   'Anglais',
            'lang_Fran\u00e7ais': 'Fran\u00e7ais',
            'lang_Allemand':  'Allemand',
            'lang_Italien':   'Italien',
            'lang_Espagnol':  'Espagnol',
            'lang_Slov\u00e8ne': 'Slov\u00e8ne',
            'lang_Arabe':     'Arabe',
            'lang_Portugais': 'Portugais',
            'lang_N\u00e9erlandais': 'N\u00e9erlandais',

            'items_count': '{count} documents',
            'items_count_one': '{count} document',
            'items_count_other': '{count} documents',
            'articles_count': '{count} articles',
            'articles_count_one': '{count} article',
            'articles_count_other': '{count} articles',
            'references_count': '{count} r\u00e9f\u00e9rences',
            'references_count_one': '{count} référence',
            'references_count_other': '{count} références',
            'publications_count': '{count} publications',
            'publications_count_one': '{count} publication',
            'publications_count_other': '{count} publications',
            'mentions_count': '{count} mentions',
            'mentions_count_one': '{count} mention',
            'mentions_count_other': '{count} mentions',

            // Summary cards (compare newspapers, periodicals overview)
            'Total words': 'Mots totaux',
            'Total pages': 'Pages totales',

            // Facet controls, pagination, tables, states
            'Global': 'Global',
            'By country': 'Par pays',
            'All countries': 'Tous les pays',
            'All types': 'Tous les types',
            'Country': 'Pays',
            // Catch-all bucket for points with no value on the active
            // facet — shared by both semantic landscapes.
            'Other': 'Autre',
            'Previous': 'Pr\u00e9c\u00e9dent',
            'Next': 'Suivant',
            'Page': 'Page',
            'Title': 'Titre',
            'Source': 'Source',
            'Type': 'Type',
            'Loading': 'Chargement',
            // Retry control on a fetch-failure banner. No `en` entry: the key
            // IS the English string (see check-i18n.js on the parity rule).
            'Try again': 'Réessayer',
            // The concordance's chip on a line whose item carries the
            // curated authority tag (shared/concordance.js, shared.ui). Its
            // French lived only in the laïcité dictionary, so any second
            // block to use the component would have shown it in English.
            'tagged': 'indexé',
            'Map library unavailable':'Biblioth\u00e8que de cartographie indisponible',
            'Loading map': 'Chargement de la carte',

            // Item type badges (user's preferred French labels)
            'item_type_article':     'Article de presse',
            'item_type_publication': 'P\u00e9riodique islamique',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Enregistrement audio-visuel',
            'item_type_reference':   'R\u00e9f\u00e9rence',
            'item_type_image':       'Photographie',

            // Document types as the bundle spells them (see the English block).
            // Identity mappings: the source labels are already French, and the
            // parity guard requires the key to exist in both dictionaries.
            'doc_type_Article de presse':               'Article de presse',
            'doc_type_P\u00e9riodique islamique':       'P\u00e9riodique islamique',
            'doc_type_Document':                        'Document',
            'doc_type_Enregistrement audio-visuel':     'Enregistrement audio-visuel',
            'doc_type_Photographie':                    'Photographie',

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

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Articles, numéros de périodiques et références liés à cette personne dans le catalogue, par année et pays de publication. Utilisez le filtre de rôle pour distinguer les notices qui traitent de la personne de celles qui la créditent comme créateur ou éditeur.',
            'desc_top_newspapers':         'Journaux et p\u00e9riodiques o\u00f9 cette personne appara\u00eet le plus souvent (top 15).',
            'desc_countries_covered':      'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_associated_entities':    'Personnes, organisations, lieux, sujets et événements associés à cette personne dans le catalogue. Le classement TF-IDF donne plus de poids aux associations propres à cette personne et moins aux entrées fréquentes dans l’ensemble de la collection. Passez du réseau à la liste classée ou à la chronologie. Les liens reflètent des notices communes et demandent une interprétation à partir des sources.',
            'desc_associated_locations':   'Lieux enregistrés sur les documents associés à cette personne comme créateur ou sujet. Ils proviennent des champs de lieux du catalogue et des mots-clés correspondants ; la carte ne retrace donc pas les déplacements de la personne.',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Articles, numéros de périodiques et références liés à cette entrée dans le catalogue, par année et pays de publication. Ces nombres reflètent les documents collectés et indexés, sans compter chaque mention dans les textes originaux.',
            'desc_entity_top_newspapers':       'Journaux et p\u00e9riodiques o\u00f9 cette entit\u00e9 est nomm\u00e9e le plus souvent (top 15).',
            'desc_entity_countries_covered':    'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_entity_associated_entities':  'Personnes, organisations, lieux, sujets et événements associés à cette entrée dans le catalogue. Le classement TF-IDF donne plus de poids aux associations propres à cette entrée et moins aux entrées fréquentes dans l’ensemble de la collection. Passez du réseau à la liste classée ou à la chronologie. Les liens reflètent des notices communes et demandent une interprétation à partir des sources.',
            'desc_entity_associated_locations': 'Lieux enregistrés sur les documents associés à cette entrée. Ils proviennent des champs de lieux du catalogue et des mots-clés correspondants ; une notice commune n’établit pas un événement ou une activité dans ce lieu.',

            // New shared panels (person + entity)
            'Year × month heatmap': 'Documents enregistrés par année et mois',
            'Top LDA topics': 'Thèmes modélisés les plus fréquents',
            'AI sentiment':                'Sentiment IA',
            'Subject co-occurrence':       'Co-occurrence de sujets',
            'desc_year_month_heatmap':     'Documents liés par année et mois de publication. Seuls les documents dont la date enregistrée comporte au moins une année et un mois sont inclus. Les cellules foncées indiquent davantage de documents ; les lacunes reflètent les notices datées disponibles et n’établissent pas une absence d’activité historique.',
            'desc_lda_topics':             'Les 12 thèmes modélisés les plus fréquents dans les articles liés à cette notice, classés par nombre d’articles. Le LDA est une méthode statistique qui regroupe les mots employés ensemble en thèmes. Ces thèmes modélisés diffèrent des mots-clés du catalogue. Les numéros de périodiques et les références sont exclus de ce panneau.',
            'desc_ai_sentiment':           'Évaluations par IA des articles liés à cette notice. La polarité décrit le ton envers l’islam et les musulmans ; la centralité, la place qui leur est accordée. Ces évaluations portent sur l’article entier, et non sur la personne ou l’organisation sélectionnée. Choisissez un modèle pour comparer ses résultats. Les numéros de périodiques et les références ne sont pas évalués.',
            'desc_subject_cooccurrence':   'Paires parmi les 15 personnes, organisations, lieux, sujets ou événements les plus fréquemment associés. Chaque valeur compte les documents dont la notice réunit les deux membres de la paire. Un document commun établit une association dans le catalogue, pas nécessairement une relation sociale.',

            // AI sentiment — axis labels. The model names are proper
            // nouns rendered verbatim from the MODELS tables in the
            // sentiment panels, so they carry no msgid.
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
            'Secondaire':   'Secondaire',
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
            'Toggle fullscreen': 'Basculer en plein \u00e9cran',

            // Canvas force graph \u2014 toolbar, legend, tooltip, selection card
            'Show all labels':              'Afficher toutes les \u00e9tiquettes',
            'Name the connections':         'Nommer les liens',
            'Freeze the layout':            'Figer la disposition',
            'Release the nodes you moved':  'Lib\u00e9rer les n\u0153uds d\u00e9plac\u00e9s',
            'Filter by entity type':        'Filtrer par type d\u2019entit\u00e9',
            'Drag to move it':              'Faites-le glisser pour le d\u00e9placer',
            'Click to see its connections': 'Cliquez pour voir ses liens',
            'Open the record':              'Ouvrir la fiche',
            'Close':                        'Fermer',
            'shared_items_count':           '{count} documents en commun',
            'shared_items_count_one':       '{count} document en commun',
            'shared_items_count_other':     '{count} documents en commun',
            'connections_count':            '{formatted} liens',
            'connections_count_one':        '{formatted} lien',
            'connections_count_other':      '{formatted} liens',
            'and_n_more':                   'et {count} autres',
            'and_n_more_one':               'et {count} autre',
            'View':                         'Vue',
            'Network view':                 'R\u00e9seau',
            'Relational list':              'Liste relationnelle',
            'Over time':                    'Dans le temps',
            'All entities':                 'Toutes',
            'Number shown':                 'Nombre affich\u00e9',
            'Period':                       'P\u00e9riode',
            'Five-year periods':            'P\u00e9riodes de cinq ans',
            'Decades':                      'D\u00e9cennies',
            'Distinctiveness ranking':      'Classement par sp\u00e9cificit\u00e9',
            'Associated entities over time': 'Entit\u00e9s associ\u00e9es dans le temps',
            'Overall mentions':             'Mentions au total',
            'shared_items_in_period':       '{count} documents en commun, {period}',
            'shared_items_in_period_one':   '{count} document en commun, {period}',
            'Ranked by distinctiveness. Curves connect entities that repeatedly appear together.':
                'Classement par sp\u00e9cificit\u00e9. Les courbes relient les entit\u00e9s qui reviennent ensemble.',
            'Rows retain the overall distinctiveness ranking. Each cell counts shared items with a readable year.':
                'Les lignes conservent le classement g\u00e9n\u00e9ral par sp\u00e9cificit\u00e9. Chaque cellule compte les documents en commun dont l\u2019ann\u00e9e est lisible.',
            'Darker cells represent more shared items.':
                'Les cellules plus fonc\u00e9es correspondent \u00e0 davantage de documents en commun.',
            'Items without a readable year are omitted: {count}.':
                'Les documents sans ann\u00e9e lisible sont omis : {count}.',
            'Network graph. Use the arrow keys to move between connected entities and Enter to select one.':
                'Graphe de r\u00e9seau. Utilisez les fl\u00e8ches pour circuler entre les entit\u00e9s reli\u00e9es et Entr\u00e9e pour en s\u00e9lectionner une.',
            'Network of the entities most associated with this record. Use the arrow keys to move between them and Enter to select one.':
                'R\u00e9seau des entit\u00e9s les plus associ\u00e9es \u00e0 cette notice. Utilisez les fl\u00e8ches pour circuler entre elles et Entr\u00e9e pour en s\u00e9lectionner une.',

            // Entity type labels (legend + tooltips of the entity graphs)
            'entity_type_center': 'Centre',
            'entity_type_Personnes': 'Personnes',
            'entity_type_Organisations': 'Organisations',
            'entity_type_Lieux': 'Lieux',
            'entity_type_Sujets': 'Sujets',
            'entity_type_\u00c9v\u00e9nements': '\u00c9v\u00e9nements',
            'entity_type_article': 'Article de presse',

            'Similarity':              'Similarit\u00e9',
            'Most frequent words':           'Mots les plus fr\u00e9quents',
            'Period covered':                'P\u00e9riode couverte',
            'mentions':                      'mentions',
            'Model':                         'Mod\u00e8le',

            // Sentiment labels a chart draws (the server-rendered panel's own
            // strings come from fr.po)
            'Not rated':               'Non \u00e9valu\u00e9',
            'Central':                 'Central',
            'Marginal':                'Marginal',
            'Mixed':                   'Mixte',

            // MapLibre choropleth toggle (shared/choropleth.js)
            'Show choropleth': 'Colorer les zones selon le nombre',
            'Show bubbles':                 'Afficher les bulles',

            'Items':                             'Documents',
            'Topic':                        'Th\u00e8me',
            'Top countries':                'Principaux pays',
            'Top values':                   'Valeurs principales',
            'desc_horizontal_bar':          'Valeurs principales tri\u00e9es de la plus \u00e9lev\u00e9e \u00e0 la plus basse.',
            'Spatial coverage': 'Lieux associés aux documents',
            'topic_other':                  'Autres th\u00e8mes',

            // Shared renderer labels
            'Calendar heatmap':         'Calendrier thermique',
            'Co-occurrence chord':      'Cordes de co-occurrence',
            'Profile comparison':       'Comparaison des profils',
            'Activity sparkline':       'Courbe d\u2019activit\u00e9',
            'Related articles':         'Articles similaires',
            'Sunburst':                 'Cercles concentriques',
            'Treemap':                  'Carte proportionnelle',
            'Untitled':                 'Sans titre',
            'No similar articles':      'Aucun article similaire',
            'desc_calendar_heatmap':    'Documents selon leur date de publication. Les cellules foncées indiquent davantage de documents. Utilisez les commandes du calendrier pour comparer les périodes ; les dates manquantes ou incomplètes limitent la couverture.',
            'cal_view_month':           'Par mois',
            'cal_view_day':             'Par jour',
            'cal_view_hijri':           'Par mois h\u00e9girien',
            'cal_hijri_era':            'H.',
            'cal_month_note':           'Une colonne par ann\u00e9e, une ligne par mois du calendrier.',
            'cal_day_note':             'Une cellule par jour, un bloc par ann\u00e9e. Utile pour rep\u00e9rer la pouss\u00e9e qui entoure un \u00e9v\u00e9nement pr\u00e9cis, au prix de beaucoup de grille vide.',
            'cal_hijri_note':           'Dates de parution converties dans le calendrier h\u00e9girien selon les tables d\u2019Umm al-Qura\u00a0: le ramadan et dhou al-hijja tiennent ainsi une ligne fixe au lieu de glisser de onze jours par an sur la grille gr\u00e9gorienne. En Afrique de l\u2019Ouest, le d\u00e9but des mois \u00e9tait fix\u00e9 par l\u2019observation locale du croissant et tombait souvent un jour avant ou apr\u00e8s la date tabulaire\u00a0; une cellule en tout d\u00e9but ou toute fin de mois peut donc relever du mois voisin.',
            'cal_skipped_note':         '{count} n\u2019ont pas pu \u00eatre converties et ne sont pas affich\u00e9es.',
            'cal_skipped_note_one':     '{count} n’a pas pu être convertie et n’est pas affichée.',
            'cal_hijri_coverage':       'Seule une date compl\u00e8te au jour pr\u00e8s se convertit en date lunaire\u00a0: cette grille couvre donc {shown} des {total} mentions qu\u2019affiche la vue gr\u00e9gorienne.',
            'desc_chord':               'Liens entre les entit\u00e9s les plus souvent mentionn\u00e9es dans cet ensemble, dispos\u00e9s en cercle. Plus le ruban est \u00e9pais, plus les deux entit\u00e9s sont mentionn\u00e9es ensemble. Seules les 30 entit\u00e9s les mieux reli\u00e9es sont trac\u00e9es, pour que le diagramme reste lisible.',
            'desc_radar_profile':       'Comparez les mesures selon des axes distincts. Chaque axe a sa propre échelle : examinez les libellés et les valeurs sans interpréter la forme ou la surface globale comme un score combiné.',
            'desc_sibling_sparkline':   'Activité dans le temps de la collection parente, par exemple cet article dans la chronologie de son journal. Le point indique le document courant.',
            'desc_similar_items':       'Articles classés par comparaison de leurs textes intégraux au moyen d’une IA. Les correspondances sous le seuil de similarité retenu sont masquées. La similarité suggère des pistes de lecture, sans établir un argument ou une source communs.',
            'desc_sunburst':            'D\u00e9composition par niveaux, en anneaux concentriques. Chaque anneau est un niveau et plus l\u2019arc est long, plus le nombre est \u00e9lev\u00e9.',
            'desc_treemap':             'D\u00e9composition par niveaux, en rectangles imbriqu\u00e9s. Cliquez sur un rectangle pour l\u2019ouvrir ; le fil d\u2019Ariane en bas permet de remonter.',

            // Pickers and search (index overview, spatial exploration)
            'Clear selection':           'Effacer la s\u00e9lection',
            'Occurrences':               'Occurrences',
            'Entity type':               'Type d\u2019entit\u00e9',
            'Search entities':           'Rechercher des entit\u00e9s',
            'No matches':                'Aucun r\u00e9sultat',
            'Places map':                'Carte des lieux',
            'Click for details':         'Cliquer pour les d\u00e9tails',
            'items':                     'documents',
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Public API                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * The plural category for `count` in the active locale, or '' when the
     * platform cannot tell us.
     *
     * English and French disagree about zero — "0 articles" but
     * "0 article" — which is why this is a lookup rather than an
     * `n === 1` test written once and wrong on one of the two sites.
     */
    function pluralCategory(count) {
        if (typeof count !== 'number' || !isFinite(count)) return '';
        if (typeof Intl === 'undefined' || !Intl.PluralRules) return '';
        try {
            return new Intl.PluralRules(ns.locale === 'fr' ? 'fr-FR' : 'en-US').select(count);
        } catch (e) {
            return '';
        }
    }

    /**
     * Translate a key. Falls back to the key itself (which is the English
     * source string) when no translation is registered.
     *
     * **Plurals.** When `params.count` is a number, `key + '_' + category`
     * is tried first — `articles_count_one`, `articles_count_other` — and
     * the bare key is the fallback, so a string that does not vary needs no
     * variants and nothing has to be migrated. Until this existed, a
     * dashboard reporting a single article said "1 articles", and French
     * "0 article" could not be expressed at all.
     *
     * **Formatting.** A numeric `count` is also written into `{count}` with
     * the locale's thousands separator, exactly as `formatNumber` would.
     * Callers used to pre-format it to get the separator, which handed t()
     * a string and silently switched the plural off: the article context
     * graph labelled every single-document edge "1 documents en commun".
     * Pass the number; a pre-formatted string still interpolates as before.
     *
     * @param {string} key
     * @param {Object} [params] Values for {placeholder} interpolation; a
     *   numeric `count` also selects a plural variant of the key
     * @returns {string}
     */
    ns.t = function (key, params) {
        var table = DICTIONARY[ns.locale] || DICTIONARY.en;
        var lookup = function (k) {
            if (table[k] !== undefined) return table[k];
            if (DICTIONARY.en[k] !== undefined) return DICTIONARY.en[k];
            return undefined;
        };

        var str;
        if (params && typeof params.count === 'number') {
            var category = pluralCategory(params.count);
            if (category) str = lookup(key + '_' + category);
        }
        if (str === undefined) str = lookup(key);
        if (str === undefined) str = key;

        if (params) {
            str = str.replace(/\{(\w+)\}/g, function (_, name) {
                var value = params[name];
                if (value == null) return '{' + name + '}';
                if (name === 'count' && typeof value === 'number') return ns.formatNumber(value);
                return value;
            });
        }
        return str;
    };

    /* ----------------------------------------------------------------- */
    /*  Numbers — the module's one formatter                              */
    /* ----------------------------------------------------------------- */

    /**
     * Every number this module prints goes through here, under one rule
     * shared with the IWAC theme and IwacSearch:
     *
     *   - thousands are grouped with U+202F (narrow no-break space) in
     *     EVERY locale — never a comma a French reader would take for a
     *     decimal mark, and the theme's own counts already read "20 944";
     *   - the decimal mark follows the PAGE locale (fr comma, en point),
     *     never the browser's;
     *   - a percent is "12,5 %" in French (U+202F before the sign) and
     *     "12.5%" in English.
     *
     * Before this, the module grouped with the page locale ("7,649" on the
     * English site), the theme with U+202F, and IwacSearch with the
     * browser's locale — three policies on one page. Display code must not
     * reach for `toFixed()` or a bare `+ '%'`; `npm run lint:i18n` fails on
     * both outside this file.
     */
    var NNBSP = '\u202F';
    ns.NNBSP = NNBSP;

    function intlNumberLocale() {
        return ns.locale === 'fr' ? 'fr-FR' : 'en-US';
    }

    var numberFormats = {};
    function numberFormat(options) {
        var key = intlNumberLocale() + '|' + JSON.stringify(options || {});
        if (!Object.prototype.hasOwnProperty.call(numberFormats, key)) {
            var made = null;
            if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
                try { made = new Intl.NumberFormat(intlNumberLocale(), options || undefined); }
                catch (e) { made = null; }
            }
            numberFormats[key] = made;
        }
        return numberFormats[key];
    }

    /** Group by hand, for an engine without Intl (or without formatToParts). */
    function groupDigits(plain) {
        var parts = String(plain).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
        return parts.join(ns.locale === 'fr' ? ',' : '.');
    }

    /**
     * Format through Intl and apply the grouping rule, or return null when
     * this engine cannot (the caller then groups by hand).
     */
    function render(value, options) {
        var format = numberFormat(options);
        if (!format || !format.formatToParts) return null;
        var parts = format.formatToParts(value);
        var out = '';
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (part.type === 'group') {
                out += NNBSP;
            } else if (part.type === 'literal' && /^\s+$/.test(part.value)
                    && parts[i + 1] && parts[i + 1].type === 'percentSign') {
                // ICU writes U+00A0 before the French percent sign; the rule is U+202F.
                out += NNBSP;
            } else {
                out += part.value;
            }
        }
        return out;
    }

    function finite(n) {
        if (n === null || n === undefined || n === '' || typeof n === 'boolean') return false;
        return isFinite(Number(n));
    }

    /** Round to at most `digits` decimals and drop trailing zeros. */
    function trimmed(value, digits) {
        var p = Math.pow(10, digits);
        return String(Math.round(value * p) / p);
    }

    /**
     * A number in the page locale: "6 000", "0,25". Anything that is not a
     * finite number passes through as a string, never as "NaN".
     *
     * @param {number} n
     * @param {Object} [options]  Intl.NumberFormat options
     * @returns {string}
     */
    ns.formatNumber = function (n, options) {
        if (!finite(n)) return n == null ? '' : String(n);
        var value = Number(n);
        var out = render(value, options);
        if (out !== null) return out;
        var max = options && options.maximumFractionDigits;
        return groupDigits(trimmed(value, max == null ? 3 : max));
    };

    /**
     * A decimal for prose and placeholders: `digits` is a MAXIMUM, so 40
     * reads "40" and 0.4567 reads "0,46" at 2. null / NaN read as an em dash.
     *
     * @param {number|null} value
     * @param {number} [digits=1]
     * @returns {string}
     */
    ns.formatDecimal = function (value, digits) {
        if (!finite(value)) return '\u2014';
        var d = digits == null ? 1 : digits;
        var out = render(Number(value), { maximumFractionDigits: d });
        return out !== null ? out : groupDigits(trimmed(Number(value), d));
    };

    /**
     * A percentage given on the 0–100 scale: "12,5 %" / "12.5%". `digits` is
     * FIXED, not a maximum, so a column of shares lines up. null / NaN read
     * as an em dash, never "NaN%".
     *
     * @param {number|null} value  e.g. 12.5 for 12.5 %
     * @param {number} [digits=1]
     * @returns {string}
     */
    ns.formatPercent = function (value, digits) {
        if (!finite(value)) return '\u2014';
        var d = digits == null ? 1 : digits;
        var out = render(Number(value) / 100, {
            style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d
        });
        if (out !== null) return out;
        return groupDigits(Number(value).toFixed(d)) + (ns.locale === 'fr' ? NNBSP + '%' : '%');
    };

    /**
     * A count abbreviated for a tight label: "4,8 k" / "4.8K", "48 M".
     * Below a thousand it is the plain number. Tooltips and tables keep the
     * exact figure.
     *
     * @param {number} n
     * @returns {string}
     */
    ns.formatCompact = function (n) {
        if (!finite(n)) return n == null ? '' : String(n);
        var value = Number(n);
        if (Math.abs(value) < 1000) return ns.formatNumber(value);
        var out = render(value, { notation: 'compact', maximumFractionDigits: 1 });
        if (out !== null) return out;
        var abs = Math.abs(value);
        var fr = ns.locale === 'fr';
        var unit = abs >= 1e9 ? [1e9, fr ? 'Md' : 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, fr ? 'k' : 'K'];
        return groupDigits(trimmed(value / unit[0], 1)) + (fr ? '\u00a0' : '') + unit[1];
    };

    /* ----------------------------------------------------------------- */
    /*  Calendar names — the module's one table                           */
    /* ----------------------------------------------------------------- */

    /**
     * Month and weekday names in the page locale, from Intl: "janv." /
     * "Jan", "janvier" / "January". The module used to keep three month
     * tables of its own — the month grids' (capitalised "Fév", which French
     * does not write), the Laïcité dictionary's, and none at all for
     * ECharts, whose French locale was never registered, so the Topic
     * Explorer calendar printed English months on French pages. Computed in
     * UTC so no visitor's time zone can shift a month or a weekday.
     *
     * @param {'short'|'long'} [width='short']
     * @returns {string[]}  twelve names, January first
     */
    var calendarCache = {};
    function calendarNames(kind, width) {
        var w = width === 'long' ? 'long' : 'short';
        var key = ns.locale + '|' + kind + '|' + w;
        if (calendarCache[key]) return calendarCache[key];
        var out = [];
        try {
            var opts = { timeZone: 'UTC' };
            opts[kind] = w;
            var format = new Intl.DateTimeFormat(ns.locale === 'fr' ? 'fr-FR' : 'en-US', opts);
            // 2001-01-01 was a Monday; 2000-12-31 a Sunday, where ECharts
            // starts its week.
            for (var i = 0; i < (kind === 'month' ? 12 : 7); i++) {
                out.push(format.format(kind === 'month'
                    ? new Date(Date.UTC(2001, i, 1))
                    : new Date(Date.UTC(2000, 11, 31 + i))));
            }
        } catch (e) {
            out = kind === 'month'
                ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        }
        calendarCache[key] = out;
        return out;
    }

    ns.monthNames = function (width) { return calendarNames('month', width).slice(); };

    /** Weekday names, Sunday first (ECharts' order). */
    ns.weekdayNames = function (width) { return calendarNames('weekday', width).slice(); };

    /**
     * A year-month key ("2024-05") as the page writes it: "May 2024" /
     * "mai 2024". Anything else passes through unchanged.
     *
     * @param {string} key
     * @returns {string}
     */
    ns.formatYearMonth = function (key) {
        var m = /^(\d{4})-(\d{2})$/.exec(String(key == null ? '' : key));
        if (!m || +m[2] < 1 || +m[2] > 12) return key == null ? '' : String(key);
        return calendarNames('month', 'long')[+m[2] - 1] + ' ' + m[1];
    };

    /** Extend the dictionary at runtime (for strings added by individual charts). */
    ns.addTranslations = function (locale, entries) {
        if (!DICTIONARY[locale]) DICTIONARY[locale] = {};
        Object.keys(entries).forEach(function (k) {
            DICTIONARY[locale][k] = entries[k];
        });
    };
})();
