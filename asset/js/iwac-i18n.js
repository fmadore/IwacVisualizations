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
            // UI chrome. The source key keeps the American spelling the call
            // sites already pass; the English value is what readers see.
            'Visualization data is not available yet.': 'The data for this visualisation has not been published yet.',

            // Chart axis / tooltip

            // Collection overview — summary labels

            // Publication (periodical issue) dashboard
            'desc_publication_run': 'Issues of this periodical per year. The dot marks this issue.',
            'desc_publication_similar': 'Issues whose tables of contents most resemble this one, compared by an AI model (Gemini).',
            'desc_publication_wordcloud': 'The words that appear most often in this issue’s text.',
            'desc_word_cloud': 'The most frequent words, sized by how often they appear.',

            // Collection overview — chart titles
            'period_covered': 'Period covered: {min} – {max}',
            'coverage_range': '{min} – {max}',

            // Aggregate runtime (P.formatTotalDuration). A SUM of runtimes,
            // not one item's — the h:mm:ss clock format belongs to a single
            // recording, and a total in it reads as a timestamp.
            'duration_hours': '{count} h',
            'duration_minutes': '{count} min',

            // Windowed charts — the "showing N of M" disclosure and its
            // escape control (P.buildWindowDisclosure). The generic pair is
            // the helper's default; the gantt_* pair names the rows for the
            // newspaper coverage chart, where "rows" would be a needlessly
            // technical word for "newspapers".
            'window_note': 'Showing {shown} of {total} rows.',
            'window_all': 'Showing all {total} rows.',
            'window_show_all': 'Show all {total}',
            'window_show_top': 'Show first {shown}',
            'gantt_window_note': 'Showing the {shown} best-covered of {total} newspapers.',
            'gantt_window_all': 'Showing all {total} newspapers.',
            'gantt_show_all': 'Show all {total}',
            'gantt_show_top': 'Show top {shown}',
            // Index-overview activity Gantt: the rows are the top entities of
            // one family, already capped at 30 by the generator, so the window
            // is a second truncation on top of a cap.
            'activity_window_note': 'Showing the {shown} most frequent of {total} entities.',
            'activity_window_all': 'Showing all {total} entities.',

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

            // Entity type tabs (must match INDEX_TYPES in the generator)

            // References overview

            // References overview — full text + topics (2026-07 pipeline)

            // References overview — semantic landscape panel
            'references_landscape_empty': 'No semantic map is available for this bibliography',
            'references_landscape_empty_umap': 'The semantic map was not computed: the umap-learn package was missing when this data was built',
            'references_landscape_empty_few': 'Too few references have extracted full text to draw a meaningful map',
            'Color by': 'Colour by',
            'Decade': 'Decade',
            'Type': 'Type',

            // Parenthetical rather than "{language}-language references":
            // the interpolated label comes from the shared `lang_*` keys and
            // arrives capitalised, which only reads correctly standalone.

            'Languages studied': 'Languages',
            'Fetching references…': 'Fetching references\u2026',

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

            // Author collaboration network (References Overview)

            // Plural-ish
            'items_count': '{count} items',
            'items_count_one': '{count} item',
            'items_count_other': '{count} items',
            'articles_count': '{count} articles',
            'articles_count_one': '{count} article',
            'articles_count_other': '{count} articles',
            'publications_count': '{count} publications',
            'publications_count_one': '{count} publication',
            'publications_count_other': '{count} publications',
            'references_count': '{count} references',
            'references_count_one': '{count} reference',
            'references_count_other': '{count} references',
            'mentions_count': '{count} mentions',
            'mentions_count_one': '{count} mention',
            'mentions_count_other': '{count} mentions',

            // Collection overview v2 — summary cards
            'References count': 'References',

            // Collection overview v2 — new chart titles

            // Collection overview v2 — facet controls & misc UI

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
            'desc_mentions_timeline':      'Articles, publications and references mentioning this person each year, stacked by country of publication.',
            'desc_top_newspapers':         'News and periodical sources where this person appears most often (top 15).',
            'desc_countries_covered':      'Distribution of mentions by country of publication of the source.',
            'desc_associated_entities':    'The entities that appear most distinctively alongside this person. The ranking (TF-IDF) favours names peculiar to this person over names that turn up everywhere in the collection. Network reveals clusters; Relational list gives the exact ranking and joins entities that repeatedly appear together; Over time shows when the shared items were published. Filter by authority type or change how many are shown.',
            'desc_associated_locations':   'Places mentioned in items where this person appears as creator or subject, taken from each item\u2019s spatial coverage field and from place tags matched against the IWAC authority list.',

            // New shared panels (person + entity)
            'desc_year_month_heatmap':     'Mentions per year and month, counted only for items whose date gives at least a year and a month. Cells stay blank where no date could be read.',
            'desc_lda_topics':             'The 12 most common themes among articles mentioning this entity, by article count. The themes come from a statistical model (LDA) run over the articles in the collection; publications and references add to the mention counts but not to the topic mix.',
            // Names no raters. The picker directly above lists them, and
            // the roster changes — this sentence still named the retired
            // January 2026 models for a release after the panel moved on.
            'desc_ai_sentiment':           'Polarity and centrality of articles mentioning this entity, as rated by each AI model in turn. The model picker switches between them and the bars update in place. Articles only: publications and references are not rated.',
            'desc_subject_cooccurrence':   'How often each pair among the 15 entities most often mentioned alongside this one appears together. The Associated entities panel puts this entity at the centre and measures the links to it; this panel sets the centre aside and asks which neighbours keep travelling together.',

            // AI sentiment — axis labels. The model names are proper
            // nouns rendered verbatim from the MODELS tables in the
            // sentiment panels, so they carry no msgid.

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
            'desc_entity_mentions_timeline':    'Articles, publications and references mentioning this entity each year, stacked by country of publication.',
            'desc_entity_top_newspapers':       'News and periodical sources where this entity is named most often (top 15).',
            'desc_entity_countries_covered':    'Distribution of mentions by country of publication of the source.',
            'desc_entity_associated_entities':  'The entities that appear most distinctively alongside this one. The ranking (TF-IDF) favours names peculiar to this entity over names that turn up everywhere in the collection. Network reveals clusters; Relational list gives the exact ranking and joins entities that repeatedly appear together; Over time shows when the shared items were published. Filter by authority type or change how many are shown.',
            'desc_entity_associated_locations': 'Places mentioned in the same items as this entity, taken from each item\u2019s spatial coverage field and from place tags matched against the IWAC authority list.',

            // Network panel toolbar + canvas force graph.
            // English keys are their own value, so only the parameterised
            // templates need an entry here; the plain labels
            // ('Show all labels', 'Freeze the layout', …) fall through the
            // identity default and are translated in the fr table below.
            'shared_items_count': '{count} shared items',
            'connections_count':        '{formatted} connections',
            'connections_count_one':    '{formatted} connection',
            'connections_count_other':  '{formatted} connections',
            'and_n_more':         'and {count} more',

            // Associated entities — three views, shared controls.
            'Network view': 'Network',
            'Relational list': 'Relational list',
            'Over time': 'Over time',
            'All entities': 'All',
            'Number shown': 'Number shown',
            'Period': 'Period',
            'Five-year periods': 'Five-year periods',
            'Decades': 'Decades',
            'Distinctiveness ranking': 'Distinctiveness ranking',
            'Associated entities over time': 'Associated entities over time',
            'Overall mentions': 'Overall mentions',
            'shared_items_in_period': '{count} shared items, {period}',
            'Ranked by distinctiveness. Curves connect entities that repeatedly appear together.':
                'Ranked by distinctiveness. Curves connect entities that repeatedly appear together.',
            'Rows retain the overall distinctiveness ranking. Each cell counts shared items with a readable year.':
                'Rows retain the overall distinctiveness ranking. Each cell counts shared items with a readable year.',
            'Darker cells represent more shared items.':
                'Darker cells represent more shared items.',
            'Items without a readable year are omitted: {count}.':
                'Items without a readable year are omitted: {count}.',

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

            // Article dashboard — panel titles

            // Article dashboard — panel descriptions (written for a
            // general audience; no jargon like "cosine similarity" or
            // "thematic siblings").
            'desc_article_context_network':
                'This article sits at the centre, surrounded by the people, places, organisations and subjects tagged in it. Articles that share several of those tags appear around the edge. Drag a node to rearrange the graph, or click one to see its connections and a link to its page.',
            'desc_article_further_reading':
                'Other material from the collection that connects to this article. Use the tabs to switch between the ways of finding it.',
            'desc_further_reading_tags':
                'Articles tagged with the same people, places, organisations or subjects as this one. The badge shows how many tags they share.',
            'desc_further_reading_scholarship':
                'Scholarly works in the IWAC bibliography whose text reads like this article: the academic literature around what it covers. This uses the same AI comparison as the previous tab, run across the two collections. Treat each result as a lead to follow rather than a citation, since a long work compared in summary can look close to many articles at once.',
            'desc_further_reading_content':
                'Articles whose full text reads similarly to this one, even when they don\u2019t share any tags. The match is computed by an AI language model that turns each article into a numeric fingerprint (a \u201csemantic embedding\u201d) and compares them. The badge shows how close the match is.',

            // Article dashboard — card labels + tooltips
            'shares_n_entities':       '{count} shared tags',
            'No related articles':     'No articles with shared tags',
            'No entities tagged':      'No entities tagged on this article',

            // Further reading — toggle labels

            // Compare newspapers block
            'Only in A':                     'Only in {name}',
            'Only in B':                     'Only in {name}',
            'Single-newspaper corpus — no breakdown': 'Single-newspaper corpus: no breakdown',
            'Sentiment only on articles':    'Sentiment ratings cover articles only',
            'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
                'Places mentioned in each corpus, matched against the IWAC authority index. The larger the bubble, the more items tagged that place.',
            'Distribution of polarity and centrality in articles of each corpus, as rated by the AI models. The picker swaps the model; publications are not rated.':
                'How polarity and centrality are distributed across the articles of each corpus, as rated by the AI models. Use the picker to change model; publications are not rated.',

            // Sentiment panel (server-rendered) — English source labels
            // match the IwacSentiment module's vocabulary maps so
            // existing translation catalogues keep working.
            // Polarity
            // Centrality
            // Subjectivity
            // Scale hint under the radar
            'Scales: polarity 1 (very negative) \u2013 5 (very positive) \u00B7 centrality 1 (not addressed) \u2013 5 (very central) \u00B7 subjectivity 1 (objective) \u2013 5 (subjective)':
                'Scales: polarity 1 (very negative) \u2013 5 (very positive) \u00B7 centrality 1 (not addressed) \u2013 5 (very central) \u00B7 subjectivity 1 (objective) \u2013 5 (subjective)',

            // MapLibre choropleth toggle (shared/choropleth.js)
            'Diverging A minus B':          'Difference: A minus B',

            // Minimal item dashboard (Audio / Video / YouTube / Document / Photograph)
            'desc_minimal_sparkline':            'Where this item sits in its collection’s activity over time. The dot marks the year of the current item.',
            'desc_minimal_similar':              'Other items in the same IWAC subset, most recent first. Click an item to open its page.',
            'desc_minimal_similar_semantic':     'Photographs an AI model reads as closest to this one. It compares the images themselves, so the resemblance is visual and thematic rather than a matter of shared catalogue records. The percentage is the similarity score.',
            'desc_minimal_sparkline_scoped':     'When this channel or collection published, year by year. The dot marks the year of the current item.',
            'desc_minimal_similar_scoped':       'Other recordings from the same channel or collection, most recent first. Click one to open its page.',
            'items_from_source':                 '{count} items from {source}',
            'hours_count':                       '{count} h',
            'minutes_count':                     '{count} min',

            // Topic Explorer — labels + descriptions
            'desc_horizontal_bar':          'Top values by count, ranked from highest to lowest.',
            'desc_topic_treemap':           'Each rectangle is one of the 30 topics found by the model; its area reflects how many articles were assigned to that topic. Click a rectangle to open the topic in detail.',
            'cal_panel_title':              'Publication calendar',
            'desc_topic_calendar':          'When articles classified into this topic were published. Only articles with a full date, down to the day, appear here; those dated to a year or a month alone are left out rather than placed on 1 January.',
            'topic_copy_link':              'Copy link to this topic',
            'topic_link_copied':            'Link copied',
            'desc_topic_countries':         'Distribution of articles in this topic by country of publication.',
            'desc_topic_newspapers':        'Newspapers and periodicals where this topic appears most often.',
            'desc_topic_top_articles':      'Articles the model attached most strongly to this topic, ranked by how confident it was.',
            // Article dashboard — spatial panel
            'desc_article_spatial':         'Places tagged on this article, located through the IWAC authority index. Every pin is one place mentioned once, so all pins are the same size. Click a pin to open the place’s record.',
            'article_place_subtitle':       'Mentioned in this article',
            'No geocoded places':           'No places on this article could be located',

            // Reference dashboard (bibliography item pages)
            'Authors':                      'Authors',
            'Publisher':                    'Publisher',
            'DOI':                          'DOI',
            'This work in the bibliography': 'This work in the bibliography',
            'Closest works in the bibliography': 'Closest works in the bibliography',
            'Press coverage this resembles': 'Press coverage this resembles',
            'desc_reference_activity':      'Where this work sits in the IWAC bibliography’s own publication timeline. The dot marks its year.',
            'desc_reference_similar':       'Works in the bibliography whose text reads most like this one, compared by an AI language model rather than by shared subject headings. Only works with extracted full text can appear, which is about half the bibliography.',
            'desc_reference_press':         'Newspaper articles from the collection whose text reads like this work: the press coverage around what it studies. A scholarly work is long and was compared in summary, so read these as leads rather than as citations.',
            'reference_topic_label':        'Topic',
            'reference_topic_model':        'Machine-generated topic words, from the model “{model}”. Each language has its own model, so topic numbers are not comparable across them.',
            'reference_topic_generated':    'Machine-generated topic words, not curated subject headings.',
            'reference_reviews_prefix':     'Reviews:',
            'reference_reviewed_by_prefix': 'Reviewed in:',

            // Distinctive Vocabulary block (keyness + bursts)
            'Loading distinctive vocabulary': 'Loading distinctive vocabulary',
            'Distinctive vocabulary':       'Distinctive vocabulary',
            'Coverage bursts':              'Coverage bursts',
            'keyness_title':                'Words that set this part of the collection apart',
            'keyness_desc':                 'Words used at least {ratio}× more often here than in the rest of the collection. Each bar shows the size of that difference, and the label gives the multiplier. Only differences unlikely to be down to chance appear (false-discovery rate {alpha}; a word needs at least {min} occurrences here to qualify). Distinctive is not the same as frequent: a word can be common everywhere and stand out nowhere.',
            'keyness_slice_caption':        '{slice}: {docs} articles, {tokens} words, {terms} distinctive terms.',
            'keyness_axis':                 'Times more frequent than elsewhere (log₂)',
            'keyness_tooltip_ratio':        'Used {ratio}× as often as in the rest of the collection',
            'keyness_tooltip_count':        '{count} occurrences in {slice}',
            'keyness_tooltip_stats':        'Log-likelihood G² {g2}, corrected p {q}',
            'bursts_title':                 'When coverage of a subject surged',
            'bursts_desc':                  'Periods when a subject was tagged on far more articles than its own long-run rate, roughly {s}× that rate or above. The episodes are found automatically, without the software being told what to look for. Each bar is one episode, and the same subject can surge more than once. A subject needs at least {min} tagged articles before its baseline is steady enough to test against. A subject that simply enters the index and stays in use does not count: that is its arrival in the cataloguing vocabulary rather than a change in coverage.',
            'bursts_caption':               '{bursts} episodes across {subjects} subjects ({found} of {tested} tested subjects burst at all).',
            'bursts_tooltip_span':          'Burst: {start}–{end}',
            'bursts_tooltip_mentions':      '{mentions} of the subject’s {total} articles fall in this burst',
            'bursts_tooltip_weight':        'Burst strength {weight}',

            'topics_over_time_title':       'Topics over time',
            'topics_over_time_desc':        'How the attention of the press shifted across themes (the 12 largest topics; the rest fold into “Other topics”). Click a band to open that topic.',
            'topic_other':                  'Other topics',
            'topics_weighting_dominant':    'Dominant topic',
            'topics_weighting_weighted':    'Probability-weighted',
            'topics_over_time_dominant_note': 'Each band is a topic’s share of the articles it was the single best label for that year, so every year sums to 100%. An article the model split evenly between three topics counts wholly for one of them.',
            'topics_over_time_weighted_note': 'Each band is the average probability the model assigned to that topic across the year’s articles, so an evenly split article contributes to all three of its topics. Only the top {k} topics of each article are recorded, so the stack tops out around {mass}% rather than 100%. The gap is thematic weight spread too thinly to be stored, and not articles left unclassified.',

            // Shared renderer labels (calendar heatmap, chord, radar,
            // sibling sparkline, similar-items strip, sunburst, treemap)
            'desc_calendar_heatmap':    'How densely publications fall over time. The darker the cell, the higher the count. The colours match the other heatmaps on this site so the two can be read side by side.',
            'cal_view_month':           'By month',
            'cal_view_day':             'By day',
            'cal_view_hijri':           'By Hijri month',
            'cal_hijri_era':            'AH',
            'cal_month_note':           'One column per year, one row per calendar month.',
            'cal_day_note':             'One cell per day, one block per year. Useful for spotting the surge around a single event, at the cost of a lot of empty grid.',
            'cal_hijri_note':           'Publication dates converted to the Islamic calendar with the Umm al-Qura tables, so Ramadan and Dhu al-Hijja hold still as rows instead of drifting eleven days a year across the Gregorian grid. Month boundaries in West Africa were set by local moon sighting and often fell a day either side of the tabular date, so a cell at the very start or end of a month may belong to its neighbour.',
            'cal_skipped_note':         '{count} could not be converted and are not shown.',
            'cal_hijri_coverage':       'Only a complete day-precision date converts to a lunar one, so this grid covers {shown} of the {total} mentions the Gregorian view shows.',
            'desc_chord':               'Links between the entities most often mentioned in this set, laid out in a circle. The thicker the ribbon, the more often the two are mentioned together. Only the 30 best-connected entities are drawn, so the diagram stays legible.',
            'desc_radar_profile':       'Side-by-side comparison along three or more axes. Each axis is scaled on its own, so the shapes stay comparable even when one measure is far larger than the others.',
            'desc_sibling_sparkline':   'Activity over time for the parent collection, such as this article within its newspaper’s timeline. The dot marks the current item.',
            'desc_similar_items':       'Articles whose full text an AI model reads as closest to this one, ranked by how close the match is. Weak matches are hidden, so very short articles do not produce misleading neighbours.',
            'desc_sunburst':            'A breakdown by level, drawn as concentric rings. Each ring is one level, and the longer the arc, the higher the count.',
            'desc_treemap':             'A breakdown by level, drawn as nested rectangles. Click a rectangle to open it; the trail at the bottom leads back up.',

            // Index overview — block + section labels

            // Index overview — Section A panel titles

            // Index overview — Section A panel descriptions

            // Index overview — summary cards + scatter axes

            // Index overview — map layer facets + index table search

            // Keyword Explorer — filters + tabs
            'Top frequent':              'Most frequent',

            // Keyword Explorer — chart + table

            // Keyword Explorer — derived panels (ROADMAP 9.7 / 9.8)
            // Spatial Exploration block
            'places_count_one':          '{count} place',
            'places_count_other':        '{count} places',
            // Entity Networks block
            'network_stats_entities':    '{nodes} entities \u00b7 {links} links',
            'network_stats_places':      '{nodes} places \u00b7 {links} links',
            'table_rows_capped':         'Showing the first {shown} of {total} rows; the CSV has all of them.',
        },
        fr: {
            'Loading dashboard': 'Chargement du tableau de bord',
            'Loading collection overview': 'Chargement de la vue d\u2019ensemble',
            'Loading project comparison': 'Chargement de la comparaison',
            'Loading newspaper comparison': 'Chargement de la comparaison des journaux',
            'Dashboard': 'Tableau de bord',
            'Visualizations': 'Visualisations',
            'Knowledge Graph': 'Graphe de connaissances',
            'Save as image': 'Enregistrer comme image',
            'Download chart': 'T\u00e9l\u00e9charger le graphique',
            // ECharts legend selector buttons (E15).
            'Show all': 'Tout afficher',
            'Invert selection': 'Inverser la sélection',
            // Map titles — MapLibre's `Map.Title` and the host's
            // aria-label, so a screen reader names the map (M8).
            'Copy embed code': 'Copier le code d\u2019int\u00e9gration',
            'Copied!': 'Copi\u00e9 !',
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
            'Show patterns': 'Afficher les motifs',
            'Hide patterns': 'Masquer les motifs',
            'No data available': 'Aucune donn\u00e9e disponible',
            'Failed to load': 'Le chargement a \u00e9chou\u00e9',
            'Visualization data is not available yet.': 'Les donn\u00e9es de visualisation ne sont pas encore disponibles.',

            'Count': 'Nombre',
            'Year': 'Ann\u00e9e',
            'Total': 'Total',
            'Logarithmic scale': '\u00c9chelle logarithmique',

            // Collection overview — summary labels
            'Total items': 'Total d\u2019items',
            'Articles': 'Articles',
            'Publications': 'Publications',
            'Documents': 'Documents',
            'Audiovisual': 'Audiovisuel',
            'References': 'R\u00e9f\u00e9rences',
            'Countries': 'Pays',
            'Languages': 'Langues',
            'Words': 'Mots',
            'Newspapers': 'Journaux',
            'Unknown': 'Inconnu',
            'Pages': 'Pages',
            'Issue': 'Numéro',
            'Language': 'Langue',
            'Date': 'Date',

            // Publication (periodical issue) dashboard
            'This issue in its periodical run': 'Ce numéro dans la collection du périodique',
            'desc_publication_run': 'Numéros de ce périodique par année. Le point marque ce numéro.',
            'Similar issues': 'Numéros similaires',
            'desc_publication_similar': 'Num\u00e9ros dont le sommaire ressemble le plus \u00e0 celui-ci, rapproch\u00e9s par un mod\u00e8le d\u2019IA (Gemini).',
            'Most frequent words in this issue': 'Mots les plus fréquents de ce numéro',
            'desc_publication_wordcloud': 'Les mots qui reviennent le plus souvent dans le texte de ce numéro.',
            'Word cloud': 'Nuage de mots',
            'desc_word_cloud': 'Les mots les plus fr\u00e9quents, dimensionn\u00e9s selon le nombre de leurs occurrences.',

            // Collection overview — chart titles
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
            'gantt_window_note': 'Affichage des {shown} journaux les mieux couverts sur {total}.',
            'gantt_window_all': 'Affichage des {total} journaux.',
            'gantt_show_all': 'Afficher les {total}',
            'gantt_show_top': 'Afficher les {shown} premiers',
            'activity_window_note': 'Affichage des {shown} entités les plus fréquentes sur {total}.',
            'activity_window_all': 'Affichage des {total} entités.',

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

            // References overview
            'Authors': 'Auteurs',
            'Publishers': 'Éditeurs',
            'Reference type': 'Type de r\u00e9f\u00e9rence',
            'Top subjects': 'Sujets r\u00e9currents',
            'No provenance locations available': 'Aucun lieu de provenance disponible',
            'No subject co-occurrence available': 'Aucune cooccurrence de sujets disponible',

            // References overview — texte intégral + thèmes (pipeline 2026-07)

            // References overview — paysage sémantique
            'references_landscape_empty': 'Aucune carte sémantique disponible pour cette bibliographie',
            'references_landscape_empty_umap': 'La carte sémantique n’a pas été calculée, faute du paquet umap-learn lors de la construction de ces données',
            'references_landscape_empty_few': 'Trop peu de références disposent d’un texte intégral extrait pour tracer une carte significative',
            'Color by': 'Colorer par',
            'Decade': 'Décennie',

            'Languages studied': 'Langues',
            'Places studied': 'Lieux \u00e9tudi\u00e9s',
            'Fetching references…': 'R\u00e9cup\u00e9ration des r\u00e9f\u00e9rences\u2026',

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

            // Author collaboration network (References Overview)
            'Co-author':             'Co-auteur',
            'Author / editor':       'Auteur / \u00e9diteur',
            'Shared references':     'R\u00e9f\u00e9rences communes',

            'items_count': '{count} \u00e9l\u00e9ments',
            'items_count_one': '{count} élément',
            'items_count_other': '{count} éléments',
            'articles_count': '{count} articles',
            'articles_count_one': '{count} article',
            'articles_count_other': '{count} articles',
            'publications_count': '{count} publications',
            'publications_count_one': '{count} publication',
            'publications_count_other': '{count} publications',
            'references_count': '{count} r\u00e9f\u00e9rences',
            'references_count_one': '{count} référence',
            'references_count_other': '{count} références',
            'mentions_count': '{count} mentions',
            'mentions_count_one': '{count} mention',
            'mentions_count_other': '{count} mentions',

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

            // Collection overview v2 — facet controls & misc UI
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
            // One item's running time, as a table column. Distinct from
            // 'av.runtime' ("Total runtime"), which labels a SUM.
            'Duration': 'Durée',
            'Type': 'Type',
            'Month': 'Mois',
            'Monthly': 'Mensuel',
            'Cumulative': 'Cumul\u00e9',
            'Monthly additions': 'Ajouts mensuels',
            'Cumulative total': 'Total cumul\u00e9',
            'Loading': 'Chargement',
            // Retry control on a fetch-failure banner. No `en` entry: the key
            // IS the English string (see check-i18n.js on the parity rule).
            'Try again': 'Réessayer',
            'Map library unavailable': 'Biblioth\u00e8que de cartographie indisponible',
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
            'Affiliations': 'Affiliations',
            'Wikidata': 'Wikidata',

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Nombre d\u2019articles, publications et r\u00e9f\u00e9rences mentionnant cette personne par ann\u00e9e, empil\u00e9 par pays de publication.',
            'desc_top_newspapers':         'Journaux et p\u00e9riodiques o\u00f9 cette personne appara\u00eet le plus souvent (top 15).',
            'desc_countries_covered':      'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_associated_entities':    'Les entit\u00e9s qui apparaissent le plus distinctement aux c\u00f4t\u00e9s de cette personne. Le classement (TF-IDF) privil\u00e9gie les noms qui lui sont propres sur ceux qui reviennent partout dans la collection. R\u00e9seau r\u00e9v\u00e8le les groupes ; Liste relationnelle donne le classement exact et relie les entit\u00e9s qui reviennent ensemble ; Dans le temps indique quand les documents en commun ont \u00e9t\u00e9 publi\u00e9s. Filtrez par type de notice d\u2019autorit\u00e9 ou modifiez le nombre affich\u00e9.',
            'desc_associated_locations':   'Lieux mentionn\u00e9s dans les notices o\u00f9 cette personne appara\u00eet comme cr\u00e9ateur ou sujet, tir\u00e9s du champ de couverture spatiale et des balises de lieux rapproch\u00e9es de la liste d\u2019autorit\u00e9 IWAC.',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Nombre d\u2019articles, publications et r\u00e9f\u00e9rences mentionnant cette entit\u00e9 par ann\u00e9e, empil\u00e9 par pays de publication.',
            'desc_entity_top_newspapers':       'Journaux et p\u00e9riodiques o\u00f9 cette entit\u00e9 est nomm\u00e9e le plus souvent (top 15).',
            'desc_entity_countries_covered':    'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_entity_associated_entities':  'Les entit\u00e9s qui apparaissent le plus distinctement aux c\u00f4t\u00e9s de celle-ci. Le classement (TF-IDF) privil\u00e9gie les noms qui lui sont propres sur ceux qui reviennent partout dans la collection. R\u00e9seau r\u00e9v\u00e8le les groupes ; Liste relationnelle donne le classement exact et relie les entit\u00e9s qui reviennent ensemble ; Dans le temps indique quand les documents en commun ont \u00e9t\u00e9 publi\u00e9s. Filtrez par type de notice d\u2019autorit\u00e9 ou modifiez le nombre affich\u00e9.',
            'desc_entity_associated_locations': 'Lieux mentionn\u00e9s dans les m\u00eames notices que cette entit\u00e9, tir\u00e9s du champ de couverture spatiale et des balises de lieux rapproch\u00e9es de la liste d\u2019autorit\u00e9 IWAC.',

            // New shared panels (person + entity)
            'Year × month heatmap':        'Carte de chaleur ann\u00e9e \u00d7 mois',
            'Top LDA topics':              'Principaux th\u00e8mes',
            'AI sentiment':                'Sentiment IA',
            'Subject co-occurrence':       'Co-occurrence de sujets',
            'desc_year_month_heatmap':     'Nombre de mentions par ann\u00e9e et par mois, calcul\u00e9 uniquement \u00e0 partir des notices dont la date donne au moins une ann\u00e9e et un mois. Les cellules restent vides l\u00e0 o\u00f9 aucune date n\u2019a pu \u00eatre lue.',
            'desc_lda_topics':             'Les 12 th\u00e8mes les plus fr\u00e9quents parmi les articles mentionnant cette entit\u00e9, par nombre d\u2019articles. Ces th\u00e8mes proviennent d\u2019un mod\u00e8le statistique (LDA) appliqu\u00e9 aux articles de la collection ; publications et r\u00e9f\u00e9rences alimentent le nombre de mentions mais pas la r\u00e9partition th\u00e9matique.',
            'desc_ai_sentiment':           'Polarit\u00e9 et centralit\u00e9 des articles mentionnant cette entit\u00e9, \u00e9valu\u00e9es tour \u00e0 tour par chaque mod\u00e8le d\u2019IA. Le s\u00e9lecteur de mod\u00e8le bascule entre eux et les barres se mettent \u00e0 jour sur place. Articles uniquement, les publications et les r\u00e9f\u00e9rences n\u2019\u00e9tant pas \u00e9valu\u00e9es.',
            'desc_subject_cooccurrence':   'Fr\u00e9quence \u00e0 laquelle chaque paire, parmi les 15 entit\u00e9s les plus souvent mentionn\u00e9es aux c\u00f4t\u00e9s de celle-ci, appara\u00eet ensemble. Le panneau Entit\u00e9s associ\u00e9es place cette entit\u00e9 au centre et mesure les liens qui y aboutissent ; celui-ci \u00e9carte le centre et demande quels voisins voyagent toujours ensemble.',

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
            'Toggle legend': 'Afficher/masquer la l\u00e9gende',
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
            'connections_count':            '{formatted} liens',
            'connections_count_one':        '{formatted} lien',
            'connections_count_other':      '{formatted} liens',
            'and_n_more':                   'et {count} autres',
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
            'Network of the entities this article is tagged with and the articles sharing them. Use the arrow keys to move between them and Enter to select one.':
                'R\u00e9seau des entit\u00e9s balis\u00e9es dans cet article et des articles qui les partagent. Utilisez les fl\u00e8ches pour circuler entre elles et Entr\u00e9e pour en s\u00e9lectionner une.',

            // Entity type labels (legend + tooltips of the entity graphs)
            'entity_type_center': 'Centre',
            'entity_type_Personnes': 'Personnes',
            'entity_type_Organisations': 'Organisations',
            'entity_type_Lieux': 'Lieux',
            'entity_type_Sujets': 'Sujets',
            'entity_type_\u00c9v\u00e9nements': '\u00c9v\u00e9nements',
            'entity_type_article': 'Article de presse',

            // Article dashboard — panel titles
            'Context network':         'R\u00e9seau contextuel',
            'Further reading':         'Pour aller plus loin',

            // Article dashboard — panel descriptions (langage accessible)
            'desc_article_context_network':
                'Cet article est au centre, entour\u00e9 des personnes, lieux, organisations et sujets qui y sont balis\u00e9s. Les articles qui partagent plusieurs de ces balises apparaissent en p\u00e9riph\u00e9rie. Faites glisser un n\u0153ud pour r\u00e9organiser le graphe ou cliquez dessus pour voir ses liens et acc\u00e9der \u00e0 sa fiche.',
            'desc_article_further_reading':
                'D\u2019autres documents de la collection qui se rattachent \u00e0 cet article. Les onglets permettent de changer de mani\u00e8re de les trouver.',
            'desc_further_reading_tags':
                'Articles balis\u00e9s avec les m\u00eames personnes, lieux, organisations ou sujets que celui-ci. Le badge indique combien de balises ils ont en commun.',
            'desc_further_reading_scholarship':
                'Travaux scientifiques de la bibliographie IWAC dont le texte se lit comme cet article, autrement dit la litt\u00e9rature savante autour de ce dont il traite. Il s\u2019agit de la m\u00eame comparaison par IA que l\u2019onglet pr\u00e9c\u00e9dent, appliqu\u00e9e d\u2019une collection \u00e0 l\u2019autre. \u00c0 consid\u00e9rer comme une piste \u00e0 explorer plut\u00f4t que comme une r\u00e9f\u00e9rence, un travail long compar\u00e9 de mani\u00e8re synth\u00e9tique pouvant sembler proche de nombreux articles \u00e0 la fois.',
            'desc_further_reading_content':
                'Articles dont le texte int\u00e9gral se lit comme celui-ci, m\u00eame sans balise en commun. La comparaison est faite par un mod\u00e8le d\u2019IA qui transforme chaque article en une empreinte num\u00e9rique, appel\u00e9e \u00ab plongement s\u00e9mantique \u00bb, puis rapproche ces empreintes. Le badge indique la proximit\u00e9.',

            // Article dashboard — card labels + tooltips
            'Similarity':              'Similarit\u00e9',
            'Shares':                  'Partage',
            'shares_n_entities':       '{count} balises partag\u00e9es',
            'No related articles':     'Aucun article avec des balises communes',
            'No further reading found':'Aucun autre article \u00e0 sugg\u00e9rer',
            'No entities tagged':      'Aucune entit\u00e9 associ\u00e9e \u00e0 cet article',

            // Further reading — toggle labels
            'By shared tags':          'Par balises communes',
            'By similar content':      'Par contenu similaire',
            'In the scholarship':      'Dans la littérature',
            'No related scholarship':  'Aucun travail scientifique proche',

            // Compare newspapers block
            'Corpus A':                      'Corpus A',
            'Corpus B':                      'Corpus B',
            'Newspaper articles':            'Articles de presse',
            'Islamic publications':          'Publications islamiques',
            'Scope':                         'P\u00e9rim\u00e8tre',
            'Selection':                     'S\u00e9lection',
            'Whole country':                 'Pays entier',
            'Single newspaper':              'Un seul journal',
            'Choose two corpora to compare': 'Choisissez deux corpus \u00e0 comparer',
            'Subject overlap':               'Chevauchement des sujets',
            'Spatial coverage overlap':      'Chevauchement des lieux couverts',
            'Timeline (items per year)':     'Chronologie (items par ann\u00e9e)',
            'Top subjects (combined top 15)': 'Principaux sujets (top 15 combin\u00e9)',
            'Most frequent words':           'Mots les plus fr\u00e9quents',
            'Newspapers within each corpus': 'Journaux dans chaque corpus',
            'Shared':                        'Communs',
            'Only in A':                     'Seulement dans {name}',
            'Only in B':                     'Seulement dans {name}',
            'No overlap':                    'Aucun chevauchement',
            'Places mentioned':              'Lieux mentionn\u00e9s',
            'Unique subjects':               'Sujets distincts',
            'Period covered':                'P\u00e9riode couverte',
            'Single-newspaper corpus \u2014 no breakdown': 'Corpus \u00e0 un seul journal, pas de d\u00e9tail',
            'Geographic comparison':         'Comparaison g\u00e9ographique',
            'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
                'Lieux mentionn\u00e9s dans chaque corpus, reli\u00e9s \u00e0 l\u2019index d\u2019autorit\u00e9 IWAC. La taille de la bulle est proportionnelle au nombre d\u2019articles o\u00f9 ce lieu est balis\u00e9.',
            'mentions':                      'mentions',
            'Open entity':                   'Ouvrir la fiche',
            'AI sentiment comparison':       'Comparaison des sentiments (IA)',
            'Distribution of polarity and centrality in articles of each corpus, as rated by the AI models. The picker swaps the model; publications are not rated.':
                'Distribution de la polarit\u00e9 et de la centralit\u00e9 des articles de chaque corpus, \u00e9valu\u00e9es par les mod\u00e8les d\u2019IA. Le s\u00e9lecteur change de mod\u00e8le\u00a0; les publications ne sont pas \u00e9valu\u00e9es.',
            'Axis':                          'Axe',
            'Model':                         'Mod\u00e8le',
            'Sentiment only on articles':    'Sentiments uniquement sur les articles',

            // Sentiment panel (server-rendered) \u2014 French translations
            // keyed on the IwacSentiment English source labels.
            'Model comparison':        'Comparaison des mod\u00e8les',
            'Show reasoning':          'Voir les justifications',
            'Not rated':               'Non \u00e9valu\u00e9',
            // Polarity
            'Very positive':           'Tr\u00e8s positif',
            'Positive':                'Positif',
            'Neutral':                 'Neutre',
            'Negative':                'N\u00e9gatif',
            'Very negative':           'Tr\u00e8s n\u00e9gatif',
            'Not applicable':          'Non applicable',
            // Centrality
            'Very central':            'Tr\u00e8s central',
            'Central':                 'Central',
            'Secondary':               'Secondaire',
            'Marginal':                'Marginal',
            'Not addressed':           'Non abord\u00e9',
            // Subjectivity
            'Very objective':          'Tr\u00e8s objectif',
            'Rather objective':        'Plut\u00f4t objectif',
            'Mixed':                   'Mixte',
            'Rather subjective':       'Plut\u00f4t subjectif',
            'Very subjective':         'Tr\u00e8s subjectif',
            // Scale hint (keyed on the English source phrase)
            'Scales: polarity 1 (very negative) \u2013 5 (very positive) \u00B7 centrality 1 (not addressed) \u2013 5 (very central) \u00B7 subjectivity 1 (objective) \u2013 5 (subjective)':
                '\u00c9chelles\u00A0: polarit\u00e9 1 (tr\u00e8s n\u00e9gatif) \u2013 5 (tr\u00e8s positif) \u00B7 centralit\u00e9 1 (non abord\u00e9) \u2013 5 (tr\u00e8s central) \u00B7 subjectivit\u00e9 1 (objectif) \u2013 5 (subjectif)',

            // Index overview — block + section labels
            // MapLibre choropleth toggle (shared/choropleth.js) \u2014 French
            'Show choropleth':              'Afficher la choropl\u00e8the',
            'Show bubbles':                 'Afficher les bulles',
            'Toggle choropleth view':       'Basculer la vue choropl\u00e8the',
            'Bubbles':                      'Bulles',
            'Show point bubbles':           'Afficher les bulles ponctuelles',
            'Diverging A minus B':          'Carte divergente A moins B',

            // Minimal item dashboard \u2014 French
            'Loading visualisations':            'Chargement des visualisations',
            'Activity over time':                'Activit\u00e9 dans le temps',
            'Other items in this collection':    'Autres \u00e9l\u00e9ments de cette collection',
            'Visually similar photographs':      'Photographies visuellement similaires',
            'desc_minimal_sparkline':            'O\u00f9 cet \u00e9l\u00e9ment se situe dans la chronologie d\u2019activit\u00e9 de sa collection. Le point indique l\u2019ann\u00e9e de l\u2019\u00e9l\u00e9ment courant.',
            'desc_minimal_similar':              'Autres \u00e9l\u00e9ments du m\u00eame sous-ensemble IWAC, du plus r\u00e9cent au plus ancien. Cliquez sur un \u00e9l\u00e9ment pour ouvrir sa fiche.',
            'desc_minimal_similar_semantic':     'Photographies qu\u2019un mod\u00e8le d\u2019IA lit comme les plus proches de celle-ci. Il compare les images elles-m\u00eames, si bien que la ressemblance est visuelle et th\u00e9matique plut\u00f4t qu\u2019une affaire de notices communes. Le pourcentage indique le score de similarit\u00e9.',
            'Activity of this source over time': 'Activit\u00e9 de cette source dans le temps',
            'More from this source':             'Autres contenus de cette source',
            'desc_minimal_sparkline_scoped':     'Le rythme de publication de cette cha\u00eene ou de cette collection, ann\u00e9e par ann\u00e9e. Le point indique l\u2019ann\u00e9e de l\u2019\u00e9l\u00e9ment courant.',
            'desc_minimal_similar_scoped':       'Autres enregistrements de la m\u00eame cha\u00eene ou de la m\u00eame collection, du plus r\u00e9cent au plus ancien. Cliquez sur l\u2019un d\u2019eux pour ouvrir sa fiche.',
            'items_from_source':                 '{count} \u00e9l\u00e9ments de {source}',
            'hours_count':                       '{count} h',
            'minutes_count':                     '{count} min',
            'Items':                             '\u00c9l\u00e9ments',
            'Videos':                            'Vid\u00e9os',
            'Total runtime':                     'Dur\u00e9e totale',
            'Median length':                     'Dur\u00e9e m\u00e9diane',
            'Watch on YouTube':                  'Regarder sur YouTube',

            // Topic Explorer \u2014 French
            'Loading Topic Explorer':       'Chargement de l\u2019explorateur de th\u00e8mes',
            'Topic distribution':           'Distribution des th\u00e8mes',
            'All topics':                   'Tous les th\u00e8mes',
            'Topic':                        'Th\u00e8me',
            'Topics':                       'Th\u00e8mes',
            'Articles classified':          'Articles classifi\u00e9s',
            'Outliers':                     'Hors th\u00e8me',
            'Back to all topics':           'Retour \u00e0 tous les th\u00e8mes',
            'cal_panel_title':              'Calendrier de publication',
            'topic_copy_link':              'Copier le lien vers ce th\u00e8me',
            'topic_link_copied':            'Lien copi\u00e9',
            'Top countries':                'Principaux pays',
            'Most representative articles': 'Articles les plus repr\u00e9sentatifs',
            'Top values':                   'Valeurs principales',
            'desc_horizontal_bar':          'Valeurs principales tri\u00e9es de la plus \u00e9lev\u00e9e \u00e0 la plus basse.',
            'desc_topic_treemap':           'Chaque rectangle est l\u2019un des 30 th\u00e8mes d\u00e9gag\u00e9s par le mod\u00e8le ; sa surface refl\u00e8te le nombre d\u2019articles qui lui ont \u00e9t\u00e9 rattach\u00e9s. Cliquez sur un rectangle pour ouvrir le th\u00e8me en d\u00e9tail.',
            'desc_topic_calendar':          'Dates de parution des articles class\u00e9s dans ce th\u00e8me. Seuls les articles dont la date est compl\u00e8te, jusqu\u2019au jour, figurent ici ; ceux dat\u00e9s d\u2019une ann\u00e9e ou d\u2019un mois seulement sont \u00e9cart\u00e9s plut\u00f4t que ramen\u00e9s au 1er janvier.',
            'desc_topic_countries':         'R\u00e9partition des articles de ce th\u00e8me par pays de publication.',
            'desc_topic_newspapers':        'Journaux et p\u00e9riodiques o\u00f9 ce th\u00e8me appara\u00eet le plus souvent.',
            'desc_topic_top_articles':      'Articles que le mod\u00e8le a rattach\u00e9s le plus fortement \u00e0 ce th\u00e8me, class\u00e9s selon sa confiance.',
            // Article dashboard \u2014 panneau spatial \u2014 French
            'Spatial coverage':             'Couverture spatiale',
            'desc_article_spatial':         'Lieux associ\u00e9s \u00e0 cet article, localis\u00e9s via l\u2019index d\u2019autorit\u00e9 IWAC. Chaque point correspond \u00e0 un lieu mentionn\u00e9 une fois : tous les points ont donc la m\u00eame taille. Cliquez sur un point pour ouvrir la fiche du lieu.',
            'article_place_subtitle':       'Mentionn\u00e9 dans cet article',
            'No geocoded places':           'Aucun lieu de cet article n\u2019a pu \u00eatre localis\u00e9',

            // Reference dashboard \u2014 French
            'Publisher':                    '\u00c9diteur',
            'DOI':                          'DOI',
            'This work in the bibliography': 'Ce travail dans la bibliographie',
            'Closest works in the bibliography': 'Travaux les plus proches dans la bibliographie',
            'Press coverage this resembles': 'Couverture de presse comparable',
            'desc_reference_activity':      'Position de ce travail dans la chronologie de publication de la bibliographie IWAC. Le point indique son ann\u00e9e.',
            'desc_reference_similar':       'Travaux de la bibliographie dont le texte se lit le plus comme celui-ci, rapproch\u00e9s par un mod\u00e8le d\u2019IA plut\u00f4t que par vedettes-mati\u00e8re communes. Seuls les travaux dont le texte int\u00e9gral a \u00e9t\u00e9 extrait peuvent appara\u00eetre, soit environ la moiti\u00e9 de la bibliographie.',
            'desc_reference_press':         'Articles de presse de la collection dont le texte se lit comme ce travail, autrement dit la couverture m\u00e9diatique de ce qu\u2019il \u00e9tudie. Un travail scientifique est long et a \u00e9t\u00e9 compar\u00e9 de mani\u00e8re synth\u00e9tique ; \u00e0 lire comme des pistes plut\u00f4t que comme des r\u00e9f\u00e9rences.',
            'reference_topic_label':        'Th\u00e8me',
            'reference_topic_model':        'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, \u00e0 partir du mod\u00e8le \u00ab {model} \u00bb. Chaque langue a son propre mod\u00e8le : les num\u00e9ros de th\u00e8mes ne sont pas comparables entre eux.',
            'reference_topic_generated':    'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, et non des vedettes-mati\u00e8re valid\u00e9es.',
            'reference_reviews_prefix':     'Compte rendu de :',
            'reference_reviewed_by_prefix': 'Recens\u00e9 dans :',

            // Distinctive Vocabulary \u2014 French
            'Loading distinctive vocabulary': 'Chargement du vocabulaire distinctif',
            'Distinctive vocabulary':       'Vocabulaire distinctif',
            'Coverage bursts':              'Pics de couverture',
            'keyness_title':                'Les mots qui distinguent cette partie de la collection',
            'keyness_desc':                 'Mots employ\u00e9s ici au moins {ratio} fois plus souvent que dans le reste de la collection. Chaque barre indique l\u2019ampleur de l\u2019\u00e9cart et l\u2019\u00e9tiquette en donne le facteur. Seuls figurent les \u00e9carts peu susceptibles d\u2019\u00eatre dus au hasard (taux de fausses d\u00e9couvertes de {alpha} ; un mot doit appara\u00eetre au moins {min} fois ici pour \u00eatre retenu). Distinctif ne veut pas dire fr\u00e9quent : un mot peut \u00eatre courant partout et ne ressortir nulle part.',
            'keyness_slice_caption':        '{slice} : {docs} articles, {tokens} mots, {terms} termes distinctifs.',
            'keyness_axis':                 'Fois plus fr\u00e9quent qu\u2019ailleurs (log\u2082)',
            'keyness_tooltip_ratio':        'Employ\u00e9 {ratio} fois plus souvent que dans le reste de la collection',
            'keyness_tooltip_count':        '{count} occurrences dans {slice}',
            'keyness_tooltip_stats':        'Log-vraisemblance G\u00b2 {g2}, p corrig\u00e9 {q}',
            'bursts_title':                 'Quand la couverture d\u2019un sujet s\u2019est intensifi\u00e9e',
            'bursts_desc':                  'P\u00e9riodes o\u00f9 un sujet a \u00e9t\u00e9 index\u00e9 sur beaucoup plus d\u2019articles que son rythme habituel, environ {s} fois ce rythme ou davantage. Ces \u00e9pisodes sont rep\u00e9r\u00e9s automatiquement, sans qu\u2019on ait indiqu\u00e9 au logiciel quoi chercher. Chaque barre correspond \u00e0 un \u00e9pisode, et un m\u00eame sujet peut s\u2019intensifier plusieurs fois. Un sujet doit compter au moins {min} articles index\u00e9s pour que son rythme de r\u00e9f\u00e9rence soit assez stable pour servir de comparaison. Un sujet qui entre dans l\u2019index et y reste employ\u00e9 ne compte pas : il s\u2019agit de son apparition dans le vocabulaire de catalogage plut\u00f4t que d\u2019une \u00e9volution de la couverture.',
            'bursts_caption':               '{bursts} \u00e9pisodes r\u00e9partis sur {subjects} sujets ({found} sujets sur {tested} test\u00e9s pr\u00e9sentent au moins un pic).',
            'bursts_tooltip_span':          'Pic : {start}-{end}',
            'bursts_tooltip_mentions':      '{mentions} des {total} articles du sujet se situent dans ce pic',
            'bursts_tooltip_weight':        'Intensit\u00e9 du pic : {weight}',

            'topics_over_time_title':       'Th\u00e8mes au fil du temps',
            'topics_over_time_desc':        'Comment l\u2019attention de la presse s\u2019est d\u00e9plac\u00e9e entre les th\u00e8mes (les 12 plus importants ; le reste est regroup\u00e9 dans \u00ab Autres th\u00e8mes \u00bb). Cliquez sur une bande pour ouvrir le th\u00e8me.',
            'topic_other':                  'Autres th\u00e8mes',
            'topics_weighting_dominant':    'Th\u00e8me dominant',
            'topics_weighting_weighted':    'Pond\u00e9r\u00e9 par probabilit\u00e9',
            'topics_over_time_dominant_note': 'Chaque bande donne la part d\u2019un th\u00e8me parmi les articles dont il est le meilleur libell\u00e9 unique pour l\u2019ann\u00e9e ; le total de chaque ann\u00e9e fait donc 100 %. Un article que le mod\u00e8le r\u00e9partit \u00e0 parts \u00e9gales entre trois th\u00e8mes est compt\u00e9 enti\u00e8rement pour l\u2019un d\u2019eux.',
            'topics_over_time_weighted_note': 'Chaque bande correspond \u00e0 la probabilit\u00e9 moyenne attribu\u00e9e par le mod\u00e8le \u00e0 ce th\u00e8me sur les articles de l\u2019ann\u00e9e ; un article r\u00e9parti \u00e0 parts \u00e9gales contribue donc \u00e0 ses trois th\u00e8mes. Seuls les {k} th\u00e8mes principaux de chaque article sont enregistr\u00e9s, si bien que l\u2019empilement plafonne autour de {mass} % et non \u00e0 100 %. L\u2019\u00e9cart correspond \u00e0 une masse th\u00e9matique trop dispers\u00e9e pour \u00eatre enregistr\u00e9e, et non \u00e0 des articles laiss\u00e9s sans classement.',

            // Shared renderer labels \u2014 French
            'Calendar heatmap':         'Calendrier thermique',
            'Co-occurrence chord':      'Cordes de co-occurrence',
            'Profile comparison':       'Comparaison des profils',
            'Activity sparkline':       'Courbe d\u2019activit\u00e9',
            'Related articles':         'Articles similaires',
            'Sunburst':                 'Cercles concentriques',
            'Treemap':                  'Carte proportionnelle',
            'Untitled':                 'Sans titre',
            'No similar articles':      'Aucun article similaire',
            'desc_calendar_heatmap':    'Densit\u00e9 des parutions dans le temps. Plus la case est sombre, plus le nombre est \u00e9lev\u00e9. Les couleurs sont celles des autres cartes de chaleur du site, afin que les deux se lisent ensemble.',
            'cal_view_month':           'Par mois',
            'cal_view_day':             'Par jour',
            'cal_view_hijri':           'Par mois h\u00e9girien',
            'cal_hijri_era':            'H.',
            'cal_month_note':           'Une colonne par ann\u00e9e, une ligne par mois du calendrier.',
            'cal_day_note':             'Une cellule par jour, un bloc par ann\u00e9e. Utile pour rep\u00e9rer la pouss\u00e9e qui entoure un \u00e9v\u00e9nement pr\u00e9cis, au prix de beaucoup de grille vide.',
            'cal_hijri_note':           'Dates de parution converties dans le calendrier h\u00e9girien selon les tables d\u2019Umm al-Qura\u00a0: le ramadan et dhou al-hijja tiennent ainsi une ligne fixe au lieu de glisser de onze jours par an sur la grille gr\u00e9gorienne. En Afrique de l\u2019Ouest, le d\u00e9but des mois \u00e9tait fix\u00e9 par l\u2019observation locale du croissant et tombait souvent un jour avant ou apr\u00e8s la date tabulaire\u00a0; une cellule en tout d\u00e9but ou toute fin de mois peut donc relever du mois voisin.',
            'cal_skipped_note':         '{count} n\u2019ont pas pu \u00eatre converties et ne sont pas affich\u00e9es.',
            'cal_hijri_coverage':       'Seule une date compl\u00e8te au jour pr\u00e8s se convertit en date lunaire\u00a0: cette grille couvre donc {shown} des {total} mentions qu\u2019affiche la vue gr\u00e9gorienne.',
            'desc_chord':               'Liens entre les entit\u00e9s les plus souvent mentionn\u00e9es dans cet ensemble, dispos\u00e9s en cercle. Plus le ruban est \u00e9pais, plus les deux entit\u00e9s sont mentionn\u00e9es ensemble. Seules les 30 entit\u00e9s les mieux reli\u00e9es sont trac\u00e9es, pour que le diagramme reste lisible.',
            'desc_radar_profile':       'Comparaison c\u00f4te \u00e0 c\u00f4te sur trois axes ou plus. Chaque axe est mis \u00e0 l\u2019\u00e9chelle s\u00e9par\u00e9ment, de sorte que les formes restent comparables m\u00eame lorsqu\u2019une mesure d\u00e9passe largement les autres.',
            'desc_sibling_sparkline':   'Activit\u00e9 dans le temps de la collection parente, par exemple cet article dans la chronologie de son journal. Le point indique l\u2019\u00e9l\u00e9ment courant.',
            'desc_similar_items':       'Articles dont le texte int\u00e9gral est, pour un mod\u00e8le d\u2019IA, le plus proche de celui-ci, class\u00e9s selon la proximit\u00e9 de la correspondance. Les correspondances faibles sont masqu\u00e9es, afin que les articles tr\u00e8s courts ne produisent pas de voisins trompeurs.',
            'desc_sunburst':            'D\u00e9composition par niveaux, en anneaux concentriques. Chaque anneau est un niveau et plus l\u2019arc est long, plus le nombre est \u00e9lev\u00e9.',
            'desc_treemap':             'D\u00e9composition par niveaux, en rectangles imbriqu\u00e9s. Cliquez sur un rectangle pour l\u2019ouvrir ; le fil d\u2019Ariane en bas permet de remonter.',

            'Loading index overview':    'Chargement de la vue d\u2019ensemble de l\u2019index',

            // Index overview — Section A panel titles
            'Lifespan \u00d7 frequency': 'Dur\u00e9e de vie \u00d7 fr\u00e9quence',

            // Index overview — Section A panel descriptions

            // Index overview — summary cards + scatter axes
            'Total entities':            'Entit\u00e9s au total',
            'With coordinates':          'Avec coordonn\u00e9es',
            'Frequency':                 'Fr\u00e9quence',

            // Index overview — map layer facets + index table search

            // Keyword Explorer — filters + tabs
            'Spatial Coverage':          'Couverture spatiale',
            'By newspaper':              'Par journal',
            'Top frequent':              'Plus fr\u00e9quents',
            'Compare':                   'Comparer',
            'Clear selection':           'Effacer la s\u00e9lection',

            // Keyword Explorer — chart + table
            'Occurrences':               'Occurrences',

            // Keyword Explorer \u2014 derived panels (ROADMAP 9.7 / 9.8)
            'Play':                      'Lecture',
            'Pause':                     'Pause',
            // Spatial Exploration block
            'Entity type':               'Type d\u2019entit\u00e9',
            'Search entities':           'Rechercher des entit\u00e9s',
            'No matches':                'Aucun r\u00e9sultat',
            'places_count_one':          '{count} lieu',
            'places_count_other':        '{count} lieux',
            'Regions':                   'R\u00e9gions',
            'Region':                    'R\u00e9gion',
            'Prefectures':               'Pr\u00e9fectures',
            'Prefecture':                'Pr\u00e9fecture',
            'Places map':                'Carte des lieux',
            'Click for details':         'Cliquer pour les d\u00e9tails',
            'items':                     '\u00e9l\u00e9ments',
            // Entity Networks block
            'network_stats_entities':    '{nodes} entit\u00e9s \u00b7 {links} liens',
            'network_stats_places':      '{nodes} lieux \u00b7 {links} liens',
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
