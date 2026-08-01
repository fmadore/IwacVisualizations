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
            // UI chrome

            // Chart axis / tooltip

            // Collection overview — summary labels

            // Publication (periodical issue) dashboard
            'desc_publication_run': 'Issues of this periodical per year — the dot marks this issue.',
            'desc_publication_similar': 'Closest issues by table-of-contents similarity (Gemini embeddings).',
            'desc_publication_wordcloud': 'The words that appear most often in this issue’s text.',
            'desc_word_cloud': 'Most frequent words, sized by how often they appear.',

            // Collection overview — chart titles
            'period_covered': 'Period covered: {min} – {max}',
            'coverage_range': '{min} – {max}',

            // Entity type tabs (must match INDEX_TYPES in the generator)

            // References overview
            'references_provenance_desc': 'Geocoded places linked to reference provenance metadata when the Hugging Face bundle exposes resolvable origins.',
            'references_subject_cooccurrence_desc': 'Pairs of subject tags that appear together on the same bibliographic reference.',

            // References overview — full text + topics (2026-07 pipeline)
            'Full-text coverage': 'Full-text coverage',
            'references_coverage_desc': 'How many references have machine-readable full text extracted, by genre of scholarship.',
            'references_coverage_desc_full': 'Full text has been extracted for {withOcr} of {total} references ({pct}%), {words} words in total, {median} in a typical reference. The topic panels below describe that digitised subset, not the whole bibliography. Bars show the digitised count per genre against its total. Separately, {published} of these references have their text published on islam.zmo.de — the rest inform the aggregate analysis here without being readable in full.',
            'references_coverage_tooltip': '{withOcr} of {total} with full text ({pct}%)',

            // References overview — semantic landscape panel
            'Semantic landscape of the literature': 'Semantic landscape of the literature',
            'references_landscape_desc': 'Each point is one reference, placed by the semantic similarity of its full text. Neighbouring points are works the embedding model reads as being about the same thing. Drag to pan, scroll to zoom, click a point to open the reference.',
            'references_landscape_desc_full': 'Each point is one reference, placed by the semantic similarity of its full text (UMAP over AI embeddings); neighbouring points are works the model reads as being about the same thing. Distances between clusters carry no meaning, and the axes have no units — only who sits near whom. This map covers the {embedded} of {total} references ({pct}%) that have extracted full text, and that half is not a random sample: it is what the collection could obtain and digitise. Drag to pan, scroll to zoom, click a point to open the reference.',
            'references_landscape_empty': 'No semantic projection available for this bibliography',
            'references_landscape_empty_umap': 'The semantic projection was not computed — umap-learn is not installed in the generating environment',
            'references_landscape_empty_few': 'Too few references have extracted full text to project a meaningful map',
            'Color by': 'Color by',
            'Decade': 'Decade',
            'Type': 'Type',

            'Scholarly topics': 'Scholarly topics',
            // Parenthetical rather than "{language}-language references":
            // the interpolated label comes from the shared `lang_*` keys and
            // arrives capitalised, which only reads correctly standalone.
            'references_topics_title_lang': 'Scholarly topics ({language})',
            'references_topics_desc': 'Topics found by an LDA model over the full text of {count} references, grouped into {topics} topics. Labels are a topic’s most characteristic words — machine-generated, not curated. Each language has its own model, so topic numbers are not comparable between these panels. Hover a bar for the references most typical of that topic.',
            'references_topic_tooltip': '{count} references ({pct}% of this model’s corpus). Most representative:',

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
            'articles_count': '{count} articles',
            'publications_count': '{count} publications',
            'references_count': '{count} references',
            'mentions_count': '{count} mentions',

            // Collection overview v2 — summary cards
            'References count': 'References',

            // Collection overview v2 — new chart titles
            'source_locations_desc': 'Archives, repositories, web platforms and publication sources linked to collection items.',
            'source_map_summary': '{sources} sources · {mapped} mapped · {items} source-linked items',

            // Collection overview v2 — facet controls & misc UI

            // Item type badges (labels match user's preferred wording for the dataset)
            'item_type_article':     'News article',
            'item_type_publication': 'Islamic periodical',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Audio-visual recording',
            'item_type_reference':   'Reference',
            'item_type_image':       'Photograph',

            // Person dashboard — labels + panels
            'Period covered_short': 'Years',

            // Person dashboard — panel descriptions (subheaders)
            'desc_mentions_timeline':      'Articles, publications and references mentioning this person each year, stacked by country of publication.',
            'desc_top_newspapers':         'News and periodical sources where this person appears most often (top 15).',
            'desc_countries_covered':      'Distribution of mentions by country of publication of the source.',
            'desc_associated_entities':    'Top 50 co-occurring entities (persons, organisations, places, subjects, events) ranked by TF-IDF distinctiveness across the items where this person is named. Thick lines run from this person to each entity; the faint dashed ones join entities that keep turning up together. Drag a node to rearrange the graph, click one to see its connections.',
            'desc_associated_locations':   'Geographic places mentioned in items where this person appears as creator or subject, drawn from each item\u2019s spatial coverage and from named-place tags joined to the IWAC authority list.',

            // New shared panels (person + entity)
            'desc_year_month_heatmap':     'Mention counts per year and month, drawn only from items with a parseable YYYY-MM date. Cells stay blank when no date can be resolved.',
            'desc_lda_topics':             'Top 12 LDA-30 topic labels for items mentioning this entity, by article count. Topics come from the precomputed LDA model on the articles subset; publications and references contribute to mention counts but not to the topic mix.',
            'desc_ai_sentiment':           'Polarity and centrality of articles mentioning this entity, with a side-by-side comparison of the three AI raters (Gemini, ChatGPT, Mistral). The model picker switches between them; the bars update in place. Articles only — publications and references are not rated.',
            'desc_subject_cooccurrence':   'Pairwise co-occurrence among the top 15 entities mentioned alongside this one. Distinct from the Associated entities network: that one is ego-centric (this entity at the centre), this one is pair-wise (which neighbours always travel together?).',

            // AI sentiment — model + axis labels

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
            'desc_entity_associated_entities':  'Top 50 co-occurring entities (persons, organisations, places, subjects, events) ranked by TF-IDF distinctiveness across the items where this entity is named. Thick lines run from this entity to each of them; the faint dashed ones join entities that keep turning up together. Drag a node to rearrange the graph, click one to see its connections.',
            'desc_entity_associated_locations': 'Geographic places mentioned in the same items as this entity, drawn from each item\u2019s spatial coverage and from named-place tags joined to the IWAC authority list.',

            // Network panel toolbar + canvas force graph.
            // English keys are their own value, so only the parameterised
            // templates need an entry here; the plain labels
            // ('Show all labels', 'Freeze the layout', …) fall through the
            // identity default and are translated in the fr table below.
            'shared_items_count': '{count} shared items',
            'connections_count':  '{count} connections',
            'one_connection':     '1 connection',
            'and_n_more':         'and {count} more',

            // Entity type labels (legend + tooltips of the entity graphs)
            'entity_type_center': 'Center',
            'entity_type_Personnes': 'Persons',
            'entity_type_Organisations': 'Organizations',
            'entity_type_Lieux': 'Places',
            'entity_type_Sujets': 'Subjects',
            'entity_type_\u00c9v\u00e9nements': 'Events',
            'entity_type_article': 'Newspaper article',

            // Article dashboard — panel titles

            // Article dashboard — panel descriptions (written for a
            // general audience; no jargon like "cosine similarity" or
            // "thematic siblings").
            'desc_article_context_network':
                'This article sits at the centre, surrounded by the people, places, organisations and subjects tagged in it. Articles that share several of those tags appear around the edge. Drag a node to rearrange the graph, click one to see its connections and a link to its page.',
            'desc_article_further_reading':
                'Other material from the collection that connects to this article. Switch between the ways of finding it.',
            'desc_further_reading_tags':
                'Articles tagged with the same people, places, organisations or subjects as this one. The badge shows how many tags they share.',
            'desc_further_reading_scholarship':
                'Scholarly works in the IWAC bibliography whose text reads similarly to this article — the academic literature around what the article covers. The same AI comparison as the previous tab, run across the two collections. Treat it as a lead to follow rather than a citation: the works are long and were compared in summary, so a broad survey can look close to many articles.',
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
            'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
                'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.',
            'Distribution of polarity and centrality in articles of each corpus, as rated by three AI models. The picker swaps the model; publications are not rated.':
                'Distribution of polarity and centrality in articles of each corpus, as rated by three AI models. The picker swaps the model; publications are not rated.',

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

            // Minimal item dashboard (Audio / Video / Document / Photograph)
            'desc_minimal_sparkline':            'Where this item sits in its collection’s activity over time. The dot marks the year of the current item.',
            'desc_minimal_similar':              'Other items in the same IWAC subset, most recent first. Click an item to open its page.',
            'desc_minimal_similar_semantic':     'Photographs closest to this one in a multimodal AI embedding of the image itself — visual and thematic resemblance, not shared metadata. The percentage is the similarity score.',

            // Topic Explorer — labels + descriptions
            'desc_horizontal_bar':          'Top values by count, ranked from highest to lowest.',
            'desc_topic_treemap':           'Each rectangle is one of the 30 LDA topics; the area scales with how many articles the model assigned to that topic. Click a rectangle to drill into the topic’s detail view.',
            'cal_panel_title':              'Publication calendar',
            'desc_topic_calendar':          'When articles classified into this topic were published. Only articles carrying a full day-precision date are placed — year-only and year-month dates are left out rather than parked on 1 January.',
            'topic_copy_link':              'Copy link to this topic',
            'topic_link_copied':            'Link copied',
            'desc_topic_countries':         'Distribution of articles in this topic by country of publication.',
            'desc_topic_newspapers':        'Newspapers and periodicals where this topic appears most often.',
            'desc_topic_top_articles':      'Articles whose text the LDA model attached most strongly to this topic, ranked by topic probability.',
            // Article dashboard — metrics row + spatial panel
            'Readability (Flesch)':         'Readability (Flesch)',
            'Lexical richness (MATTR)':     'Lexical richness (MATTR)',
            'article_topic_generated':      'Topic words assigned by an LDA model over the article’s full text — machine output, not a curated subject heading.',
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
            'desc_reference_press':         'Newspaper articles from the collection whose text reads like this work — the press coverage around what it studies. A scholarly work is long and was compared in summary, so read these as leads rather than as citations.',
            'reference_topic_label':        'Topic',
            'reference_topic_model':        'Machine-generated topic words, from the model “{model}”. Each language has its own model, so topic numbers are not comparable across them.',
            'reference_topic_generated':    'Machine-generated topic words, not curated subject headings.',
            'reference_reviews_prefix':     'Reviews:',
            'reference_reviewed_by_prefix': 'Reviewed in:',

            // Distinctive Vocabulary block (keyness + bursts)
            'Loading distinctive vocabulary': 'Loading distinctive vocabulary',
            'Distinctive vocabulary':       'Distinctive vocabulary',
            'Coverage bursts':              'Coverage bursts',
            'keyness_title':                'Words that set this subcorpus apart',
            'keyness_desc':                 'Words used at least {ratio}× more often here than in the rest of the collection. Bars are the size of that difference; the label gives the multiplier. Only differences unlikely to be chance are shown (false-discovery rate {alpha}, words needing at least {min} occurrences in the subcorpus). This is not the same as “most frequent”: a word can be common everywhere and distinctive nowhere.',
            'keyness_slice_caption':        '{slice}: {docs} articles, {tokens} words, {terms} distinctive terms.',
            'keyness_axis':                 'Times more frequent than elsewhere (log₂)',
            'keyness_tooltip_ratio':        'Used {ratio}× as often as in the rest of the collection',
            'keyness_tooltip_count':        '{count} occurrences in {slice}',
            'keyness_tooltip_stats':        'Log-likelihood G² {g2}, corrected p {q}',
            'bursts_title':                 'When coverage of a subject erupted',
            'bursts_desc':                  'Periods when a subject was tagged on far more articles than its own long-run rate — roughly {s}× or above, found without being told what to look for. Each bar is one episode: the same subject can erupt more than once. Subjects need at least {min} tagged articles before their base rate is stable enough to test against. A subject simply entering the index and staying in use does not count: that is its arrival in the vocabulary, not a change in coverage.',
            'bursts_caption':               '{bursts} episodes across {subjects} subjects ({found} of {tested} tested subjects burst at all).',
            'bursts_tooltip_span':          'Burst: {start}–{end}',
            'bursts_tooltip_mentions':      '{mentions} of the subject’s {total} articles fall in this burst',
            'bursts_tooltip_weight':        'Burst strength {weight}',

            'topics_over_time_title':       'Topics over time',
            'topics_over_time_desc':        'How the press’s attention shifted across themes (largest 12 topics; the rest fold into “Other topics”). Click a band to drill into the topic.',
            'topic_other':                  'Other topics',
            'topics_weighting_dominant':    'Dominant topic',
            'topics_weighting_weighted':    'Probability-weighted',
            'topics_over_time_dominant_note': 'Each band is a topic’s share of the articles it was the single best label for that year, so every year sums to 100%. An article the model split evenly between three topics counts wholly for one of them.',
            'topics_over_time_weighted_note': 'Each band is the average probability the model assigned to that topic across the year’s articles, so an evenly-split article contributes to all three of its topics. Only each article’s top {k} topics are available, so the stack tops out around {mass}% rather than 100% — the headroom is topic mass too thinly spread to be recorded, not unclassified articles.',

            // Shared renderer labels (calendar heatmap, chord, radar,
            // sibling sparkline, similar-items strip, sunburst, treemap)
            'desc_calendar_heatmap':    'Publication density over time. Colour intensity scales with the count, on the same theme palette as the other heatmaps so they read together.',
            'cal_view_month':           'By month',
            'cal_view_day':             'By day',
            'cal_view_hijri':           'By Hijri month',
            'cal_hijri_era':            'AH',
            'cal_month_note':           'One column per year, one row per calendar month.',
            'cal_day_note':             'One cell per day, one block per year. Good for spotting the burst around a single event, at the cost of a lot of empty grid.',
            'cal_hijri_note':           'Publication dates converted to the Islamic calendar with the Umm al-Qura tables, so Ramadan and Dhu al-Hijja hold still as rows instead of drifting eleven days a year across the Gregorian grid. Month boundaries in West Africa were set by local moon sighting and often fell a day either side of the tabular date, so a cell at the very start or end of a month may belong to its neighbour.',
            'cal_skipped_note':         '{count} could not be converted and are not shown.',
            'desc_chord':               'Pairwise links between the top entities mentioned in this set, laid out in a circle. Edge thickness encodes co-occurrence weight; the layout caps at the 30 most central nodes so the chord stays legible.',
            'desc_radar_profile':       'Side-by-side comparison along three or more scaled axes. Each axis is rescaled independently so the shapes can be compared even when one metric dwarfs the others on absolute scale.',
            'desc_sibling_sparkline':   'Activity over time for the parent collection (e.g. this article in its newspaper’s timeline). The dot marks the current item.',
            'desc_similar_items':       'Articles whose full text is closest to this one in semantic embedding space, ranked by cosine similarity. Shown only above a low-signal threshold so very short articles don’t produce noisy neighbours.',
            'desc_sunburst':            'Hierarchical breakdown shown as concentric rings. Each ring is one level of the hierarchy; arc length scales with the count.',
            'desc_treemap':             'Hierarchical breakdown shown as nested rectangles. Click a parent to drill in; the breadcrumb at the bottom navigates back up.',

            // Index overview — block + section labels
            'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
                'Prevalence of Dublin Core Subject and Spatial Coverage tags over time. Counts reflect item-level tagging, not text occurrence: an item tagged "Terrorism" contributes one mention to that year, no matter how many times the word appears in the body.',

            // Index overview — Section A panel titles
            'Top entities':              'Most frequent entities in Dublin Core Subject and Spatial Coverage',

            // Index overview — Section A panel descriptions
            'desc_top_entities':   'Authority records that appear most often in item-level Dublin Core Subject (dcterms:subject) and Spatial Coverage (dcterms:spatial) fields. Click a bar to open the entity\u2019s page.',
            'desc_lifespan':       'Each point is one entity: horizontal axis is the span in years between its first and last occurrence, vertical axis is its total mention count, color encodes entity type. Click a point to open the entity.',
            'desc_temporal_extent': 'First and last year each top entity appears in the corpus (up to 30 per type, ranked by frequency). Each bar spans from earliest to latest mention.',
            'desc_places_map':     'Two complementary layers on the same map. Authority pins: every place in the IWAC authority index that has geographic coordinates. Mention bubbles: how often each place is tagged in an item\u2019s Dublin Core Spatial Coverage field, joined back to the authority pin by name. Click a pin to open the place\u2019s page.',

            // Index overview — summary cards + scatter axes

            // Index overview — map layer facets + index table search

            // Keyword Explorer — filters + tabs
            'top_n_keywords':            '{count} keywords',
            'select_up_to_n':            'Select up to {count} keywords',

            // Keyword Explorer — chart + table
            'top_n_over_time':           'Top {count} keywords over time',

            // Keyword Explorer — derived panels (ROADMAP 9.7 / 9.8)
            'desc_subjects_bump':        'Rank of the leading subjects per decade — a climbing line took attention away from a sinking one. A line breaks where the subject drops out of the decade top 8; hover a decade for ranks and counts.',
            'desc_geo_attention':        'How much attention the press gave each country over time, measured by how often articles were catalogued as being about it. Drag the year slider or press play. The colour scale is the same in every year, so a darker country always means heavier coverage — whatever year you are viewing.',
            // Spatial Exploration block
            'spatial_pick_hint':         'Pick an entity to map the places mentioned alongside it. Without a selection, the map shows every place in the collection.',
            'places_count':              '{count} places',
            'spatial_map_description':   'Bubble size reflects how often a place is mentioned. Hover a place for a preview; click it for the full list of items.',
            'admin_units_count':         '{count} units',
            'more_items_click':          '{count} more \u2014 click for the full list',
            // Entity Networks block
            'networks_description':      'Entities appearing in the same items, positioned by co-occurrence strength. Click a node to inspect its connections.',
            'network_select_hint':       'Click a node to see its strongest co-occurrences; click the background to clear.',
            'network_stats_entities':    '{nodes} entities \u00b7 {links} links',
            'network_stats_places':      '{nodes} places \u00b7 {links} links',
            'network_links_note':        'A link joins two entities that appear in the same item at least {count} times.',
            'cooccurrence_title':        'Co-occur in {count} items',
            'more_links_count':          '+{count} more links',
            'links_count':               '{count} links',
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
            'Copy embed code': 'Copier le code d\u2019int\u00e9gration',
            'Copied!': 'Copi\u00e9 !',
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
            'Entities': 'Entit\u00e9s',
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
            'desc_publication_run': 'Numéros de ce périodique par année — le point marque ce numéro.',
            'Similar issues': 'Numéros similaires',
            'desc_publication_similar': 'Numéros les plus proches par similarité des sommaires (plongements Gemini).',
            'Most frequent words in this issue': 'Mots les plus fréquents de ce numéro',
            'desc_publication_wordcloud': 'Les mots qui reviennent le plus souvent dans le texte de ce numéro.',
            'Word cloud': 'Nuage de mots',
            'desc_word_cloud': 'Les mots les plus fréquents, dimensionnés selon leur occurrence.',

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
            'Top publishers': '\u00c9diteurs les plus cit\u00e9s',
            'Top subjects': 'Sujets r\u00e9currents',
            'Reference provenance': 'Provenance des r\u00e9f\u00e9rences',
            'references_provenance_desc': 'Lieux g\u00e9ocod\u00e9s li\u00e9s aux m\u00e9tadonn\u00e9es de provenance des r\u00e9f\u00e9rences lorsque le jeu Hugging Face fournit des origines r\u00e9solvables.',
            'references_subject_cooccurrence_desc': 'Paires de sujets apparaissant ensemble sur une m\u00eame r\u00e9f\u00e9rence bibliographique.',
            'No provenance locations available': 'Aucun lieu de provenance disponible',
            'No subject co-occurrence available': 'Aucune cooccurrence de sujets disponible',

            // References overview — texte intégral + thèmes (pipeline 2026-07)
            'Full-text coverage': 'Couverture en texte intégral',
            'references_coverage_desc': 'Nombre de références dont le texte intégral a été extrait, par genre de travaux.',
            'references_coverage_desc_full': 'Le texte intégral a été extrait pour {withOcr} références sur {total} ({pct} %), soit {words} mots au total et {median} pour une référence typique. Les panneaux de thèmes ci-dessous décrivent ce sous-ensemble numérisé, et non l’ensemble de la bibliographie. Les barres indiquent le nombre de références numérisées par genre, rapporté à son total. Par ailleurs, {published} de ces références ont leur texte publié sur islam.zmo.de : les autres alimentent l’analyse agrégée présentée ici sans être consultables intégralement.',
            'references_coverage_tooltip': '{withOcr} sur {total} avec texte intégral ({pct} %)',

            // References overview — paysage sémantique
            'Semantic landscape of the literature': 'Paysage sémantique de la littérature scientifique',
            'references_landscape_desc': 'Chaque point est une référence, positionnée selon la proximité sémantique de son texte intégral. Les points voisins sont des travaux que le modèle lit comme portant sur le même objet. Faites glisser pour vous déplacer, utilisez la molette pour zoomer, cliquez sur un point pour ouvrir la référence.',
            'references_landscape_desc_full': 'Chaque point est une référence, positionnée selon la proximité sémantique de son texte intégral (UMAP sur des plongements produits par IA) ; les points voisins sont des travaux que le modèle lit comme portant sur le même objet. Les distances entre grappes n’ont pas de signification et les axes n’ont pas d’unité : seul le voisinage compte. Cette carte couvre les {embedded} références sur {total} ({pct} %) dont le texte intégral a été extrait, et cette moitié n’est pas un échantillon aléatoire : c’est ce que la collection a pu obtenir et numériser. Faites glisser pour vous déplacer, utilisez la molette pour zoomer, cliquez sur un point pour ouvrir la référence.',
            'references_landscape_empty': 'Aucune projection sémantique disponible pour cette bibliographie',
            'references_landscape_empty_umap': 'La projection sémantique n’a pas été calculée : umap-learn n’est pas installé dans l’environnement de génération',
            'references_landscape_empty_few': 'Trop peu de références disposent d’un texte intégral extrait pour projeter une carte significative',
            'Color by': 'Colorer par',
            'Decade': 'Décennie',

            'Scholarly topics': 'Thèmes de la littérature scientifique',
            'references_topics_title_lang': 'Thèmes de la littérature scientifique ({language})',
            'references_topics_desc': 'Thèmes dégagés par un modèle LDA sur le texte intégral de {count} références, regroupées en {topics} thèmes. Les libellés sont les mots les plus caractéristiques du thème : ils sont générés automatiquement et non validés éditorialement. Chaque langue a son propre modèle : les numéros de thèmes ne sont donc pas comparables d’un panneau à l’autre. Survolez une barre pour voir les références les plus représentatives du thème.',
            'references_topic_tooltip': '{count} références ({pct} % du corpus de ce modèle). Les plus représentatives :',
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
            'Author collaborations': 'Collaborations entre auteurs',
            'Co-author':             'Co-auteur',
            'Author / editor':       'Auteur / \u00e9diteur',
            'Shared references':     'R\u00e9f\u00e9rences communes',

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
            'Source locations': 'Localisation des sources',
            'source_locations_desc': 'Archives, dépôts, plateformes web et sources de publication associés aux éléments de la collection.',
            'source_map_summary': '{sources} sources · {mapped} localisées · {items} éléments liés à une source',
            'No mapped sources': 'Aucune source localisée',

            // Collection overview v2 — facet controls & misc UI
            'Global': 'Global',
            'By type': 'Par type',
            'By country': 'Par pays',
            'By year': 'Par ann\u00e9e',
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
            'Coordinates': 'Coordonnées',
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
            'item_type_image':       'Photographie',

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
            'desc_associated_entities':    'Top 50 des entit\u00e9s co-occurrentes (personnes, organisations, lieux, sujets, \u00e9v\u00e9nements) class\u00e9es par score TF-IDF dans les notices o\u00f9 cette personne est nomm\u00e9e. Les traits \u00e9pais relient cette personne \u00e0 chaque entit\u00e9 ; les pointill\u00e9s discrets relient les entit\u00e9s qui reviennent ensemble. Faites glisser un n\u0153ud pour r\u00e9organiser le graphe, cliquez dessus pour voir ses liens.',
            'desc_associated_locations':   'Lieux g\u00e9ographiques mentionn\u00e9s dans les notices o\u00f9 cette personne appara\u00eet comme cr\u00e9ateur ou sujet, extraits de la couverture spatiale et des balises de lieux li\u00e9es \u00e0 la liste d\u2019autorit\u00e9 IWAC.',

            // Entity dashboard (Lieux / Organisations / Sujets / Événements) — panel descriptions
            'desc_entity_mentions_timeline':    'Nombre d\u2019articles, publications et r\u00e9f\u00e9rences mentionnant cette entit\u00e9 par ann\u00e9e, empil\u00e9 par pays de publication.',
            'desc_entity_top_newspapers':       'Journaux et p\u00e9riodiques o\u00f9 cette entit\u00e9 est nomm\u00e9e le plus souvent (top 15).',
            'desc_entity_countries_covered':    'R\u00e9partition des mentions par pays de publication de la source.',
            'desc_entity_associated_entities':  'Top 50 des entit\u00e9s co-occurrentes (personnes, organisations, lieux, sujets, \u00e9v\u00e9nements) class\u00e9es par score TF-IDF dans les notices o\u00f9 cette entit\u00e9 est nomm\u00e9e. Les traits \u00e9pais relient cette entit\u00e9 \u00e0 chacune d\u2019elles ; les pointill\u00e9s discrets relient les entit\u00e9s qui reviennent ensemble. Faites glisser un n\u0153ud pour r\u00e9organiser le graphe, cliquez dessus pour voir ses liens.',
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
            'connections_count':            '{count} liens',
            'one_connection':               '1 lien',
            'and_n_more':                   'et {count} autres',
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
                'Cet article est au centre, entour\u00e9 des personnes, lieux, organisations et sujets qui y sont balis\u00e9s. Les articles qui partagent plusieurs de ces balises apparaissent en p\u00e9riph\u00e9rie. Faites glisser un n\u0153ud pour r\u00e9organiser le graphe, cliquez dessus pour voir ses liens et un lien vers sa fiche.',
            'desc_article_further_reading':
                'D\u2019autres documents de la collection qui se rattachent \u00e0 cet article. Choisissez l\u2019une des mani\u00e8res de les trouver.',
            'desc_further_reading_tags':
                'Articles balis\u00e9s avec les m\u00eames personnes, lieux, organisations ou sujets que celui-ci. Le badge indique combien de balises ils ont en commun.',
            'desc_further_reading_scholarship':
                'Travaux scientifiques de la bibliographie IWAC dont le texte se lit de mani\u00e8re similaire \u00e0 cet article \u2014 la litt\u00e9rature savante autour de ce dont il traite. Il s\u2019agit de la m\u00eame comparaison par IA que l\u2019onglet pr\u00e9c\u00e9dent, appliqu\u00e9e d\u2019une collection \u00e0 l\u2019autre. \u00c0 consid\u00e9rer comme une piste \u00e0 explorer plut\u00f4t que comme une r\u00e9f\u00e9rence : ces travaux sont longs et ont \u00e9t\u00e9 compar\u00e9s de mani\u00e8re synth\u00e9tique, si bien qu\u2019une synth\u00e8se g\u00e9n\u00e9rale peut sembler proche de nombreux articles.',
            'desc_further_reading_content':
                'Articles dont le texte int\u00e9gral se lit de mani\u00e8re similaire \u00e0 celui-ci, m\u00eame sans balise en commun. La comparaison est faite par un mod\u00e8le d\u2019IA qui transforme chaque article en une \u00ab empreinte num\u00e9rique \u00bb (un \u00ab plongement s\u00e9mantique \u00bb) puis les rapproche. Le badge indique la proximit\u00e9.',

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
            'Single-newspaper corpus \u2014 no breakdown': 'Corpus \u00e0 un seul journal \u2014 pas de d\u00e9tail',
            'Geographic comparison':         'Comparaison g\u00e9ographique',
            'Places mentioned in each corpus, joined to the IWAC authority index. Bubble size scales with the number of items that tagged each place.':
                'Lieux mentionn\u00e9s dans chaque corpus, reli\u00e9s \u00e0 l\u2019index d\u2019autorit\u00e9 IWAC. La taille de la bulle est proportionnelle au nombre d\u2019articles o\u00f9 ce lieu est balis\u00e9.',
            'mentions':                      'mentions',
            'Open entity':                   'Ouvrir la fiche',
            'AI sentiment comparison':       'Comparaison des sentiments (IA)',
            'Distribution of polarity and centrality in articles of each corpus, as rated by three AI models. The picker swaps the model; publications are not rated.':
                'Distribution de la polarit\u00e9 et de la centralit\u00e9 des articles de chaque corpus, \u00e9valu\u00e9es par trois mod\u00e8les d\u2019IA. Le s\u00e9lecteur change de mod\u00e8le\u00a0; les publications ne sont pas \u00e9valu\u00e9es.',
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
            'Loading visualizations':            'Chargement des visualisations',
            'Activity over time':                'Activit\u00e9 dans le temps',
            'Other items in this collection':    'Autres \u00e9l\u00e9ments de cette collection',
            'Visually similar photographs':      'Photographies visuellement similaires',
            'desc_minimal_sparkline':            'O\u00f9 cet \u00e9l\u00e9ment se situe dans la chronologie d\u2019activit\u00e9 de sa collection. Le point indique l\u2019ann\u00e9e de l\u2019\u00e9l\u00e9ment courant.',
            'desc_minimal_similar':              'Autres \u00e9l\u00e9ments du m\u00eame sous-ensemble IWAC, du plus r\u00e9cent au plus ancien. Cliquez sur un \u00e9l\u00e9ment pour ouvrir sa fiche.',
            'desc_minimal_similar_semantic':     'Photographies les plus proches de celle-ci dans un plongement multimodal de l\u2019image elle-m\u00eame : ressemblance visuelle et th\u00e9matique, et non m\u00e9tadonn\u00e9es partag\u00e9es. Le pourcentage indique le score de similarit\u00e9.',

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
            'desc_topic_treemap':           'Chaque rectangle est l\u2019un des 30 th\u00e8mes LDA ; la surface est proportionnelle au nombre d\u2019articles que le mod\u00e8le a rattach\u00e9s au th\u00e8me. Cliquez pour explorer le d\u00e9tail du th\u00e8me.',
            'desc_topic_calendar':          'Dates de parution des articles classifi\u00e9s dans ce th\u00e8me. Seuls les articles dont la date est pr\u00e9cise au jour sont plac\u00e9s : les dates r\u00e9duites \u00e0 l\u2019ann\u00e9e ou au mois sont \u00e9cart\u00e9es plut\u00f4t que ramen\u00e9es au 1er janvier.',
            'desc_topic_countries':         'R\u00e9partition des articles de ce th\u00e8me par pays de publication.',
            'desc_topic_newspapers':        'Journaux et p\u00e9riodiques o\u00f9 ce th\u00e8me appara\u00eet le plus souvent.',
            'desc_topic_top_articles':      'Articles que le mod\u00e8le LDA a rattach\u00e9s le plus fortement \u00e0 ce th\u00e8me, class\u00e9s par probabilit\u00e9 d\u2019appartenance.',
            // Article dashboard \u2014 m\u00e9triques + panneau spatial \u2014 French
            'Readability (Flesch)':         'Lisibilit\u00e9 (Flesch)',
            'Lexical richness (MATTR)':     'Richesse lexicale (MATTR)',
            'Spatial coverage':             'Couverture spatiale',
            'article_topic_generated':      'Mots-cl\u00e9s de th\u00e8me attribu\u00e9s par un mod\u00e8le LDA sur le texte int\u00e9gral de l\u2019article : sortie automatique, et non une vedette-mati\u00e8re valid\u00e9e.',
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
            'desc_reference_similar':       'Travaux de la bibliographie dont le texte se lit le plus comme celui-ci, rapproch\u00e9s par un mod\u00e8le d\u2019IA et non par vedettes-mati\u00e8re communes. Seuls les travaux dont le texte int\u00e9gral a \u00e9t\u00e9 extrait peuvent appara\u00eetre, soit environ la moiti\u00e9 de la bibliographie.',
            'desc_reference_press':         'Articles de presse de la collection dont le texte se lit comme ce travail \u2014 la couverture m\u00e9diatique de ce qu\u2019il \u00e9tudie. Un travail scientifique est long et a \u00e9t\u00e9 compar\u00e9 de mani\u00e8re synth\u00e9tique : \u00e0 lire comme des pistes plut\u00f4t que comme des r\u00e9f\u00e9rences.',
            'reference_topic_label':        'Th\u00e8me',
            'reference_topic_model':        'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, \u00e0 partir du mod\u00e8le \u00ab {model} \u00bb. Chaque langue a son propre mod\u00e8le : les num\u00e9ros de th\u00e8mes ne sont pas comparables entre eux.',
            'reference_topic_generated':    'Mots-cl\u00e9s de th\u00e8me g\u00e9n\u00e9r\u00e9s automatiquement, et non des vedettes-mati\u00e8re valid\u00e9es.',
            'reference_reviews_prefix':     'Compte rendu de :',
            'reference_reviewed_by_prefix': 'Recens\u00e9 dans :',

            // Distinctive Vocabulary \u2014 French
            'Loading distinctive vocabulary': 'Chargement du vocabulaire distinctif',
            'Distinctive vocabulary':       'Vocabulaire distinctif',
            'Coverage bursts':              'Pics de couverture',
            'keyness_title':                'Les mots qui distinguent ce sous-corpus',
            'keyness_desc':                 'Mots employ\u00e9s ici au moins {ratio} fois plus souvent que dans le reste de la collection. La longueur des barres indique l\u2019ampleur de l\u2019\u00e9cart ; l\u2019\u00e9tiquette en donne le facteur. Seuls les \u00e9carts peu susceptibles d\u2019\u00eatre dus au hasard sont affich\u00e9s (taux de fausses d\u00e9couvertes de {alpha} ; les mots doivent appara\u00eetre au moins {min} fois dans le sous-corpus). Ce n\u2019est pas la m\u00eame chose que \u00ab les plus fr\u00e9quents \u00bb : un mot peut \u00eatre courant partout et distinctif nulle part.',
            'keyness_slice_caption':        '{slice} : {docs} articles, {tokens} mots, {terms} termes distinctifs.',
            'keyness_axis':                 'Fois plus fr\u00e9quent qu\u2019ailleurs (log\u2082)',
            'keyness_tooltip_ratio':        'Employ\u00e9 {ratio} fois plus souvent que dans le reste de la collection',
            'keyness_tooltip_count':        '{count} occurrences dans {slice}',
            'keyness_tooltip_stats':        'Log-vraisemblance G\u00b2 {g2}, p corrig\u00e9 {q}',
            'bursts_title':                 'Quand la couverture d\u2019un sujet s\u2019est emball\u00e9e',
            'bursts_desc':                  'P\u00e9riodes o\u00f9 un sujet a \u00e9t\u00e9 index\u00e9 sur beaucoup plus d\u2019articles que son rythme habituel \u2014 environ {s} fois ou plus \u2014, rep\u00e9r\u00e9es sans qu\u2019on ait indiqu\u00e9 quoi chercher. Chaque barre correspond \u00e0 un \u00e9pisode : un m\u00eame sujet peut s\u2019emballer plusieurs fois. Un sujet doit compter au moins {min} articles index\u00e9s pour que son rythme de r\u00e9f\u00e9rence soit assez stable pour servir de comparaison. L\u2019entr\u00e9e d\u2019un sujet dans l\u2019index, suivie d\u2019un usage constant, n\u2019est pas compt\u00e9e : il s\u2019agit de son apparition dans le vocabulaire et non d\u2019une \u00e9volution de la couverture.',
            'bursts_caption':               '{bursts} \u00e9pisodes r\u00e9partis sur {subjects} sujets ({found} sujets sur {tested} test\u00e9s pr\u00e9sentent au moins un pic).',
            'bursts_tooltip_span':          'Pic : {start}-{end}',
            'bursts_tooltip_mentions':      '{mentions} des {total} articles du sujet se situent dans ce pic',
            'bursts_tooltip_weight':        'Intensit\u00e9 du pic : {weight}',

            'topics_over_time_title':       'Th\u00e8mes au fil du temps',
            'topics_over_time_desc':        'Comment l\u2019attention de la presse s\u2019est d\u00e9plac\u00e9e entre les th\u00e8mes (les 12 principaux th\u00e8mes ; le reste est regroup\u00e9 dans \u00ab Autres th\u00e8mes \u00bb). Cliquez sur une bande pour explorer le th\u00e8me.',
            'topic_other':                  'Autres th\u00e8mes',
            'topics_weighting_dominant':    'Th\u00e8me dominant',
            'topics_weighting_weighted':    'Pond\u00e9r\u00e9 par probabilit\u00e9',
            'topics_over_time_dominant_note': 'Chaque bande repr\u00e9sente la part d\u2019un th\u00e8me parmi les articles dont il est le meilleur libell\u00e9 unique pour l\u2019ann\u00e9e : le total de chaque ann\u00e9e fait donc 100 %. Un article que le mod\u00e8le r\u00e9partit \u00e0 parts \u00e9gales entre trois th\u00e8mes est compt\u00e9 enti\u00e8rement pour l\u2019un d\u2019eux.',
            'topics_over_time_weighted_note': 'Chaque bande correspond \u00e0 la probabilit\u00e9 moyenne attribu\u00e9e par le mod\u00e8le \u00e0 ce th\u00e8me sur les articles de l\u2019ann\u00e9e : un article r\u00e9parti \u00e0 parts \u00e9gales contribue donc \u00e0 ses trois th\u00e8mes. Seuls les {k} th\u00e8mes principaux de chaque article sont disponibles, si bien que l\u2019empilement plafonne autour de {mass} % et non \u00e0 100 % \u2014 l\u2019espace restant correspond \u00e0 une masse th\u00e9matique trop dispers\u00e9e pour \u00eatre enregistr\u00e9e, et non \u00e0 des articles non class\u00e9s.',

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
            'desc_calendar_heatmap':    'Densit\u00e9 des parutions dans le temps. L\u2019intensit\u00e9 de la couleur refl\u00e8te le nombre d\u2019occurrences, sur la m\u00eame palette que les autres cartes de chaleur afin qu\u2019elles se lisent ensemble.',
            'cal_view_month':           'Par mois',
            'cal_view_day':             'Par jour',
            'cal_view_hijri':           'Par mois h\u00e9girien',
            'cal_hijri_era':            'H.',
            'cal_month_note':           'Une colonne par ann\u00e9e, une ligne par mois du calendrier.',
            'cal_day_note':             'Une cellule par jour, un bloc par ann\u00e9e. Utile pour rep\u00e9rer le pic entourant un \u00e9v\u00e9nement pr\u00e9cis, au prix de beaucoup de grille vide.',
            'cal_hijri_note':           'Dates de parution converties dans le calendrier h\u00e9girien selon les tables d\u2019Umm al-Qura\u00a0: le ramadan et dhou al-hijja tiennent ainsi une ligne fixe au lieu de glisser de onze jours par an sur la grille gr\u00e9gorienne. En Afrique de l\u2019Ouest, le d\u00e9but des mois \u00e9tait fix\u00e9 par l\u2019observation locale du croissant et tombait souvent un jour avant ou apr\u00e8s la date tabulaire\u00a0; une cellule en tout d\u00e9but ou toute fin de mois peut donc relever du mois voisin.',
            'cal_skipped_note':         '{count} n\u2019ont pas pu \u00eatre converties et ne sont pas affich\u00e9es.',
            'desc_chord':               'Liens deux \u00e0 deux entre les entit\u00e9s les plus mentionn\u00e9es, dispos\u00e9s en cercle. L\u2019\u00e9paisseur du trait encode le poids de la co-occurrence\u00a0; le diagramme se limite aux 30 n\u0153uds les plus centraux pour rester lisible.',
            'desc_radar_profile':       'Comparaison c\u00f4te \u00e0 c\u00f4te sur trois axes ou plus. Chaque axe est r\u00e9-\u00e9chelonn\u00e9 ind\u00e9pendamment afin que les formes restent comparables m\u00eame si une mesure \u00e9crase les autres en valeur absolue.',
            'desc_sibling_sparkline':   'Activit\u00e9 dans le temps pour la collection parente (par exemple cet article dans la chronologie de son journal). Le point indique l\u2019\u00e9l\u00e9ment courant.',
            'desc_similar_items':       'Articles dont le texte int\u00e9gral est le plus proche de celui-ci dans l\u2019espace s\u00e9mantique des plongements, class\u00e9s par similarit\u00e9 cosinus. Ne sont affich\u00e9s qu\u2019au-dessus d\u2019un seuil de signal afin que les articles tr\u00e8s courts ne produisent pas de voisins bruit\u00e9s.',
            'desc_sunburst':            'D\u00e9composition hi\u00e9rarchique en anneaux concentriques. Chaque anneau est un niveau de la hi\u00e9rarchie\u00a0; la longueur de l\u2019arc est proportionnelle au nombre.',
            'desc_treemap':             'D\u00e9composition hi\u00e9rarchique en rectangles imbriqu\u00e9s. Cliquez sur un parent pour zoomer\u00a0; le fil d\u2019Ariane en bas permet de remonter.',

            'Loading index overview':    'Chargement de la vue d\u2019ensemble de l\u2019index',
            'Entity Index Explorer':     'Explorateur d\u2019entit\u00e9s',
            'Keyword Explorer':          'Explorateur de mots-cl\u00e9s',
            'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
                'Pr\u00e9valence des indexations Dublin Core Sujet et Couverture spatiale dans le temps. Les comptes refl\u00e8tent l\u2019indexation au niveau de la notice, pas l\u2019occurrence dans le texte : une notice index\u00e9e \u00ab Terrorisme \u00bb compte pour une seule mention cette ann\u00e9e-l\u00e0, peu importe combien de fois le mot appara\u00eet dans le corps du texte.',

            // Index overview — Section A panel titles
            'Entities by type':          'Entit\u00e9s par type',
            'Top entities':              'Entit\u00e9s les plus fr\u00e9quentes dans les champs Sujet et Couverture spatiale (Dublin Core)',
            'Lifespan \u00d7 frequency': 'Dur\u00e9e de vie \u00d7 fr\u00e9quence',
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

            // Keyword Explorer \u2014 derived panels (ROADMAP 9.7 / 9.8)
            'Rising and falling subjects': 'Sujets montants et descendants',
            'desc_subjects_bump':        'Rang des principaux sujets par d\u00e9cennie \u2014 une ligne qui monte prend l\u2019attention d\u2019une ligne qui descend. Une ligne s\u2019interrompt quand le sujet sort du top 8 de la d\u00e9cennie ; survolez une d\u00e9cennie pour les rangs et les comptes.',
            'Geographic attention over time': 'Attention g\u00e9ographique au fil du temps',
            'desc_geo_attention':        'L\u2019attention accord\u00e9e par la presse \u00e0 chaque pays au fil du temps, mesur\u00e9e par la fr\u00e9quence \u00e0 laquelle les articles ont \u00e9t\u00e9 catalogu\u00e9s comme le concernant. Faites glisser le curseur ou lancez la lecture. L\u2019\u00e9chelle de couleurs est identique chaque ann\u00e9e : un pays plus sombre signifie toujours une couverture plus forte, quelle que soit l\u2019ann\u00e9e affich\u00e9e.',
            'Play':                      'Lecture',
            'Pause':                     'Pause',
            // Spatial Exploration block
            'Entity type':               'Type d\u2019entit\u00e9',
            'Pick an entity':            'Choisir une entit\u00e9',
            'Search entities':           'Rechercher des entit\u00e9s',
            'No matches':                'Aucun r\u00e9sultat',
            'spatial_pick_hint':         'Choisissez une entit\u00e9 pour cartographier les lieux mentionn\u00e9s \u00e0 ses c\u00f4t\u00e9s. Sans s\u00e9lection, la carte montre tous les lieux de la collection.',
            'places_count':              '{count} lieux',
            'View item page':            'Voir la fiche de l\u2019\u00e9l\u00e9ment',
            'Top places':                'Principaux lieux',
            'Map mode':                  'Mode de carte',
            'Place bubbles':             'Bulles de lieux',
            'Country choropleth':        'Choropl\u00e8the par pays',
            'Administrative choropleth': 'Choropl\u00e8the administrative',
            'Country focus':             'Focus pays',
            'Whole world':               'Monde entier',
            'Admin level':               'Niveau administratif',
            'Regions':                   'R\u00e9gions',
            'Region':                    'R\u00e9gion',
            'Prefectures':               'Pr\u00e9fectures',
            'Prefecture':                'Pr\u00e9fecture',
            'Scale':                     '\u00c9chelle',
            'Quantile':                  'Quantile',
            'Linear':                    'Lin\u00e9aire',
            'Square root':               'Racine carr\u00e9e',
            'Places map':                'Carte des lieux',
            'spatial_map_description':   'La taille des bulles refl\u00e8te la fr\u00e9quence de mention d\u2019un lieu. Survolez un lieu pour un aper\u00e7u\u202f; cliquez pour la liste compl\u00e8te des \u00e9l\u00e9ments.',
            'admin_units_count':         '{count} unit\u00e9s',
            'No administrative data':    'Aucune donn\u00e9e administrative',
            'No mapped places':          'Aucun lieu cartographi\u00e9',
            'Click for details':         'Cliquer pour les d\u00e9tails',
            'more_items_click':          '{count} de plus \u2014 cliquer pour la liste compl\u00e8te',
            'items':                     '\u00e9l\u00e9ments',
            // Entity Networks block
            'Co-occurrence network':     'R\u00e9seau de cooccurrences',
            'networks_description':      'Les entit\u00e9s qui apparaissent dans les m\u00eames \u00e9l\u00e9ments, positionn\u00e9es selon la force de cooccurrence. Cliquez sur un n\u0153ud pour inspecter ses connexions.',
            'About this network':        '\u00c0 propos de ce r\u00e9seau',
            'network_select_hint':       'Cliquez sur un n\u0153ud pour voir ses cooccurrences les plus fortes\u202f; cliquez sur le fond pour effacer.',
            'network_stats_entities':    '{nodes} entit\u00e9s \u00b7 {links} liens',
            'network_stats_places':      '{nodes} lieux \u00b7 {links} liens',
            'network_links_note':        'Un lien relie deux entit\u00e9s qui apparaissent dans le m\u00eame \u00e9l\u00e9ment au moins {count} fois.',
            'Strongest co-occurrences':  'Cooccurrences les plus fortes',
            'cooccurrence_title':        'Cooccurrence dans {count} \u00e9l\u00e9ments',
            'more_links_count':          '+{count} liens suppl\u00e9mentaires',
            'links_count':               '{count} liens',
            'Min. link strength':        'Force min. des liens',
            'All links':                 'Tous les liens',
            'Find in network':           'Chercher dans le r\u00e9seau',
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
