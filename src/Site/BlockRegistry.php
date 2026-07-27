<?php
namespace IwacVisualizations\Site;

/**
 * The one place a page block is described.
 *
 * A block used to be declared in four unreconciled places: the invokable name
 * in `config/module.config.php`, the label + description + partial path in its
 * `BlockLayout` subclass, a SECOND copy of the label in
 * `EmbedController::BLOCKS`, and the `embedSlug` string in its template.
 * Nothing cross-checked them, and the failure mode was real: v1.21 shipped
 * `press-reprints` registered under the embed slug `press-reprints-detector`
 * while its partial was `press-reprints.phtml`, so every embed of that block
 * 500'd on a missing view script until v1.22.0.
 *
 * Now the slug is the spine. It is simultaneously:
 *   - the key of this table,
 *   - the partial name (`common/block-layout/<slug>`),
 *   - the `data-embed-slug` a template emits,
 *   - the embed route segment (`/s/:site/iwac-embed/<slug>`).
 *
 * `scripts/check-blocks.js` (part of `npm run build`) asserts that the config
 * invokables, the `BlockLayout` subclasses, the templates and this table all
 * still agree, so the next drift fails the build instead of the page.
 *
 * The `invokable` name stays literal in `config/module.config.php`: module
 * config is read while Omeka is still bootstrapping, before this class is
 * reliably autoloadable, so deriving it there would be fragile. The lint
 * script closes that loop instead.
 *
 * Labels and descriptions keep their `// @translate` markers here — that is
 * what Omeka's gettext extraction reads, and the msgids are unchanged from
 * when they lived on the subclasses, so `language/fr.po` keeps working.
 */
final class BlockRegistry
{
    /**
     * slug => [invokable, class, label, description, embeddable].
     *
     * `embeddable` gates the block from the snippet gallery and the
     * `/iwac-embed/:block` route. Every block qualifies today (they are all
     * zero-configuration and site-context-only); the flag exists so a future
     * block that needs `$block` data cannot silently 500 the embed route.
     */
    const BLOCKS = [
        'collection-overview' => [
            'invokable'   => 'collectionOverview',
            'class'       => BlockLayout\CollectionOverview::class,
            'label'       => 'Collection Overview', // @translate
            'description' => 'Aggregate visualizations across the entire collection. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'compare-newspapers' => [
            'invokable'   => 'compareNewspapers',
            'class'       => BlockLayout\CompareNewspapers::class,
            'label'       => 'Compare Newspapers', // @translate
            'description' => 'Side-by-side comparison of two newspaper corpora (articles or Islamic publications), scoped either to a whole country or a single newspaper. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'distinctive-vocabulary' => [
            'invokable'   => 'distinctiveVocabulary',
            'class'       => BlockLayout\DistinctiveVocabulary::class,
            'label'       => 'Distinctive Vocabulary', // @translate
            'description' => 'What sets each part of the press apart, in two views: the vocabulary a country or a decade uses more than the rest of the collection does (log-likelihood keyness with a false-discovery correction, ranked by effect size), and the years in which coverage of a subject suddenly spiked above its own base rate (Kleinberg burst detection). Complements Term Trends, which shows how often a word is used rather than where it stands out. Data is precomputed from the IWAC articles. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'entity-networks' => [
            'invokable'   => 'entityNetworks',
            'class'       => BlockLayout\EntityNetworks::class,
            'label'       => 'Entity Networks', // @translate
            'description' => 'Co-occurrence networks across the collection: an entity graph linking persons, organizations, events, subjects and places that appear in the same items (layout precomputed), and a geographic network of co-mentioned places drawn over the basemap. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'index-overview' => [
            'invokable'   => 'indexOverview',
            'class'       => BlockLayout\IndexOverview::class,
            'label'       => 'Index Overview', // @translate
            'description' => 'Explore authority entities (persons, places, organisations, events, topics) and Dublin Core Subject + Spatial Coverage prevalence over time. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'lexical-metrics' => [
            'invokable'   => 'lexicalMetrics',
            'class'       => BlockLayout\LexicalMetrics::class,
            'label'       => 'Press Language', // @translate
            'description' => 'Press language metrics of the newspaper articles: readability (Flesch), lexical richness (MATTR) and article length over time, with newspapers ranked by readability and richness. Data is precomputed from the OCR text of the IWAC articles subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'on-this-day' => [
            'invokable'   => 'onThisDay',
            'class'       => BlockLayout\OnThisDay::class,
            'label'       => 'On This Day', // @translate
            'description' => 'Items published on today\'s date across the collection\'s decades — newspaper articles and periodical issues with full publication dates. The block removes itself silently when no data is available, so it is safe on a homepage. Data is precomputed from the IWAC dataset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'org-cooccurrence' => [
            'invokable'   => 'orgCooccurrence',
            'class'       => BlockLayout\OrgCooccurrence::class,
            'label'       => 'Islamic Organisations Co-occurrence', // @translate
            'description' => 'A heatmap of the ideas that cluster around each major West African Islamic organisation (UIB, CNI, COSIM, CSI, FAIB, UMT) in the press: for a chosen organisation, which pairs of words keep turning up together near its name. Data is precomputed from the IWAC articles. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'periodicals-landscape' => [
            'invokable'   => 'periodicalsLandscape',
            'class'       => BlockLayout\PeriodicalsLandscape::class,
            'label'       => 'Periodicals Semantic Landscape', // @translate
            'description' => 'Zoomable map of the Islamic-periodical corpus: every issue placed by the semantic similarity of its table of contents (UMAP over AI embeddings), color-faceted by country or decade. Data is precomputed. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'periodicals-overview' => [
            'invokable'   => 'periodicalsOverview',
            'class'       => BlockLayout\PeriodicalsOverview::class,
            'label'       => 'Periodicals Overview', // @translate
            'description' => 'Islamic periodicals overview: publication runs, issues per year by country, languages, countries, and top subjects. Data is precomputed from the IWAC publications subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'press-bylines' => [
            'invokable'   => 'pressBylines',
            'class'       => BlockLayout\PressBylines::class,
            'label'       => 'Press Bylines', // @translate
            'description' => 'Who signed the press: byline coverage over time and the most prolific journalists and press agencies, with active spans and frequent subjects, linked to their authority records where they exist. Data is precomputed from the IWAC articles subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'press-reprints' => [
            'invokable'   => 'pressReprints',
            'class'       => BlockLayout\PressReprints::class,
            'label'       => 'Press Reprints', // @translate
            'description' => 'Pairs of near-identical articles printed by different newspapers — syndicated wire copy (PANA, AFP), shared communiqués and reprints — found by comparing how closely articles are worded. Shows which outlets circulated the same copy, with the full pair list. Data is precomputed from the IWAC articles. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'references-overview' => [
            'invokable'   => 'referencesOverview',
            'class'       => BlockLayout\ReferencesOverview::class,
            'label'       => 'References Overview', // @translate
            'description' => 'Bibliographic references overview: timeline, types, languages, countries, top authors and subjects, country-by-type treemap, and co-authorship network. Data is precomputed from the IWAC references subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'scary-terms' => [
            'invokable'   => 'scaryTerms',
            'class'       => BlockLayout\ScaryTerms::class,
            'label'       => 'Scary Terms', // @translate
            'description' => 'Radical / extremism-related terms across the IWAC collection in seven views: an animated bar-chart race, time trends with historical-event markers, by country, global, a co-occurrence matrix, a word cloud of the surrounding vocabulary, and a map of the places mentioned. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'semantic-landscape' => [
            'invokable'   => 'semanticLandscape',
            'class'       => BlockLayout\SemanticLandscape::class,
            'label'       => 'Semantic Landscape', // @translate
            'description' => 'Zoomable map of the whole press corpus: every article placed by the semantic similarity of its full text (UMAP over AI embeddings), color-faceted by country, decade, or topic. Data is precomputed. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'sentiment-atlas' => [
            'invokable'   => 'sentimentAtlas',
            'class'       => BlockLayout\SentimentAtlas::class,
            'label'       => 'Sentiment Atlas', // @translate
            'description' => 'AI sentiment atlas of the newspaper articles: polarity, centrality of Islam and subjectivity over time and by country as rated by three language models, plus cross-model agreement. All figures are AI-generated assessments precomputed from the IWAC articles subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'spatial-exploration' => [
            'invokable'   => 'spatialExploration',
            'class'       => BlockLayout\SpatialExploration::class,
            'label'       => 'Spatial Exploration', // @translate
            'description' => 'Interactive world map of every place mentioned in the collection, with country focus and an entity picker (persons, organizations, events, subjects, places) that maps the locations related to the selected entity. Data is precomputed. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'term-trends' => [
            'invokable'   => 'termTrends',
            'class'       => BlockLayout\TermTrends::class,
            'label'       => 'Term Trends', // @translate
            'description' => 'The IWAC "Ngram viewer": plot the per-year share of articles whose full text contains any frequent term. Search the vocabulary, overlay up to eight terms, switch between share and absolute counts. Data is precomputed from the articles subset. No configuration needed.', // @translate
            'embeddable'  => true,
        ],
        'topic-explorer' => [
            'invokable'   => 'topicExplorer',
            'class'       => BlockLayout\TopicExplorer::class,
            'label'       => 'Topic Explorer', // @translate
            'description' => 'LDA-30 topic overview of the IWAC articles subset, with a treemap of all topics and a per-topic drill-down (calendar heatmap, country / newspaper distributions, most-representative articles). No configuration needed.', // @translate
            'embeddable'  => true,
        ],
    ];

    /** Every registered slug, in declaration order. */
    public static function slugs(): array
    {
        return array_keys(self::BLOCKS);
    }

    /** One block's row, or null for an unknown slug. */
    public static function get(string $slug): ?array
    {
        return self::BLOCKS[$slug] ?? null;
    }

    /** Slug for a BlockLayout class, or null when it is not registered. */
    public static function slugForClass(string $class): ?string
    {
        foreach (self::BLOCKS as $slug => $row) {
            if ($row['class'] === $class) {
                return $slug;
            }
        }
        return null;
    }

    /**
     * `slug => label` for every embeddable block — the embed whitelist and the
     * snippet gallery's listing. Doubles as the directory-traversal guard for
     * `common/block-layout/<slug>`, since only known slugs resolve.
     */
    public static function embeddable(): array
    {
        $out = [];
        foreach (self::BLOCKS as $slug => $row) {
            if (!empty($row['embeddable'])) {
                $out[$slug] = $row['label'];
            }
        }
        return $out;
    }
}
