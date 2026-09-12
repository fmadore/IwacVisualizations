<?php
declare(strict_types=1);

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
        'audiovisual-overview' => [
            'invokable'   => 'audiovisualOverview',
            'class'       => BlockLayout\AudiovisualOverview::class,
            'label'       => 'Audiovisual Overview', // @translate
            'description' => 'Compare collected recordings by source, country, duration and publication year, and see which catalogue fields are available.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        'chartOptions' => true,
                        // Also pulls faceted-chart.js, which the dual-measure panel uses.
                        'facetButtons' => true,
                        // Implies pagination — table.js's own dependency.
                        'table'        => true,
                    ],
                    'bundle' => 'audiovisual-overview',
                ],
                'blockClass' => 'iwac-vis-audiovisual-overview',
                'loading'    => 'Loading audiovisual overview', // @translate
            ],
        ],
        'collection-overview' => [
            'invokable'   => 'collectionOverview',
            'class'       => BlockLayout\CollectionOverview::class,
            'label'       => 'Collection Overview', // @translate
            'description' => 'Explore the collection by date, country, language, document type and source, with views of catalogue growth and frequently indexed entries.', // @translate
            'embeddable'  => true,
        ],
        'compare-newspapers' => [
            'invokable'   => 'compareNewspapers',
            'class'       => BlockLayout\CompareNewspapers::class,
            'label'       => 'Compare Newspapers', // @translate
            'description' => 'Compare two selections of newspaper articles or Islamic periodical issues by publication year, catalogue tags, vocabulary and available AI ratings. Choose a country or a single publication for each selection.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'compare-newspapers',
                    'needs' => [
                        'wordcloud'    => true,
                        'chartOptions' => true,
                        'maplibre'     => true,
                        'pagination'   => true,
                    ],
                    // The bundle: shared helpers (side colors + uid counter) first, then
                    // one module per panel, then the orchestrator, which dispatches into
                    // them via IWACVis.compareNewspapers. The file list and its order
                    // live in asset/js/bundles.json.
                    'bundle' => 'compare-newspapers',
                ],
                'blockClass' => 'iwac-vis-compare-newspapers',
                'loading'    => 'Loading newspaper comparison', // @translate
            ],
        ],
        'distinctive-vocabulary' => [
            'invokable'   => 'distinctiveVocabulary',
            'class'       => BlockLayout\DistinctiveVocabulary::class,
            'label'       => 'Distinctive Vocabulary', // @translate
            'description' => 'Find words used at higher relative rates in one country or decade than in the remaining newspaper articles. A second view identifies periods of increased use of subject tags. Statistical thresholds are explained alongside the charts.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'distinctive-vocabulary',
                    'needs' => [
                        'chartOptions' => true,
                        // Country / Decade switch on the keyness section.
                        'facetButtons' => true,
                    ],
                    'bundle' => 'distinctive-vocabulary',
                ],
                'blockClass' => 'iwac-vis-keyness',
                'loading'    => 'Loading distinctive vocabulary', // @translate
            ],
        ],
        'entity-networks' => [
            'invokable'   => 'entityNetworks',
            'class'       => BlockLayout\EntityNetworks::class,
            'label'       => 'Entity Networks', // @translate
            'description' => 'Explore links between people, organisations, places, subjects and events recorded on the same items. Shared records indicate catalogue associations, which require interpretation through the sources.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'entity-networks',
                    'needs' => [
                        'maplibre' => true,
                        'facetButtons' => true,
                    ],
                    'bundle' => 'entity-networks',
                ],
                'blockClass' => 'iwac-vis-networks',
                'loading'    => 'Loading entity networks', // @translate
            ],
        ],
        'index-overview' => [
            'invokable'   => 'indexOverview',
            'class'       => BlockLayout\IndexOverview::class,
            'label'       => 'Index Overview', // @translate
            'description' => 'Explore the catalogue index and the use of subject and place tags over time. Counts describe recorded associations rather than word occurrences in the original texts.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'index-overview',
                    'needs' => [
                        'maplibre'     => true,
                        'chartOptions' => true,
                        'facetButtons' => true,
                        'table'        => true,
                        'pagination'   => true,
                    ],
                    'bundle' => 'index-overview',
                ],
                'blockClass' => 'iwac-vis-index-overview',
                'loading'    => 'Loading index overview', // @translate
            ],
        ],
        'laicite' => [
            'invokable'   => 'laicite',
            'class'       => BlockLayout\Laicite::class,
            'label'       => 'Laïcité', // @translate
            'description' => 'Explore a dossier selected through the Laïcité subject tag and vocabulary in titles and available full text, including YouTube transcripts. Compare source types, terms in context, associated entries and AI ratings. Descriptive fields are excluded from vocabulary counts; extracts follow each field’s public status.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    // Five sheets, in cascade order: the shell every view sits
                    // in, then the views. One 1,458-line file meant a change to
                    // the concordance scrolled past the arenas (C5).
                    'blockCss' => [
                        'laicite-shell',
                        'laicite-overview',
                        'laicite-concordance',
                        'laicite-lexicon',
                        'laicite-context',
                    ],
                    'needs' => [
                        'chartOptions' => true,
                        'facetButtons' => true,
                        // Timeline view — the annotated time series shared with Scary
                        // Terms; concordance view — the shared KWIC renderer, which
                        // implies pagination; map view — the MapLibre stack.
                        'timeline'     => true,
                        'concordance'  => true,
                        'maplibre'     => true,
                        // The per-corpus table is built by hand (row-header + meter),
                        // but it borrows shared/table.js's card-role tagging so it
                        // collapses into labelled records on a phone like every other
                        // table in the module.
                        'table'        => true,
                    ],
                    // The bundle: i18n strings + stateless builders + the fourteen view
                    // modules + the controls row, then the orchestrator (which aliases
                    // the builders and reads the registered translations). The file
                    // list and its order live in asset/js/bundles.json.
                    'bundle' => 'laicite',
                ],
                'blockClass' => 'iwac-vis-laicite',
                'loading'    => 'Loading laïcité dossier', // @translate
                'siteBase'   => true,
            ],
        ],
        'lexical-metrics' => [
            'invokable'   => 'lexicalMetrics',
            'class'       => BlockLayout\LexicalMetrics::class,
            'label'       => 'Press Language', // @translate
            'description' => 'Compare estimated reading ease, vocabulary diversity and article length over time and by newspaper. Measures use extracted text; the charts explain the scores and their limitations.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        'chartOptions' => true,
                    ],
                    'bundle' => 'lexical-metrics',
                ],
                'blockClass' => 'iwac-vis-lexical-metrics',
                'loading'    => 'Loading press language metrics', // @translate
            ],
        ],
        'on-this-day' => [
            'invokable'   => 'onThisDay',
            'class'       => BlockLayout\OnThisDay::class,
            'label'       => 'On This Day', // @translate
            'description' => 'Show articles and periodical issues published on today’s date in earlier years. Switch between Gregorian and converted Islamic-calendar dates, and between list, decade and clipping layouts. Only records with suitable dates can appear.', // @translate
            'embeddable'  => true,
        ],
        'org-cooccurrence' => [
            'invokable'   => 'orgCooccurrence',
            'class'       => BlockLayout\OrgCooccurrence::class,
            'label'       => 'Islamic Organisations Co-occurrence', // @translate
            'description' => 'Compare pairs of words found near the names of selected Islamic organisations in newspaper articles. Darker cells indicate pairs found together in more articles.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'org-cooccurrence',
                    'needs' => [
                        'chartOptions' => true,
                    ],
                    'bundle' => 'org-cooccurrence',
                ],
                'blockClass' => 'iwac-vis-orgcooc',
                'loading'    => 'Loading organisation co-occurrences', // @translate
            ],
        ],
        'periodicals-landscape' => [
            'invokable'   => 'periodicalsLandscape',
            'class'       => BlockLayout\PeriodicalsLandscape::class,
            'label'       => 'Periodicals Semantic Landscape', // @translate
            'description' => 'Explore Islamic periodical issues arranged by an AI comparison of their tables of contents. Nearby points suggest issues to compare; positions and distances are approximate.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        // C.landscape — the UMAP scatter option the three landscape
                        // views share.
                        'chartOptions' => true,
                        'facetButtons' => true,
                    ],
                    'bundle' => 'semantic-landscape',
                ],
                'blockClass' => 'iwac-vis-periodicals-landscape',
                'loading'    => 'Loading semantic landscape', // @translate
            ],
        ],
        'periodicals-overview' => [
            'invokable'   => 'periodicalsOverview',
            'class'       => BlockLayout\PeriodicalsOverview::class,
            'label'       => 'Periodicals Overview', // @translate
            'description' => 'Explore Islamic periodical holdings by year, publication, country, language and catalogue subject, with vocabulary and statistically modelled themes. Gaps in the collection do not establish gaps in publication.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        'chartOptions' => true,
                        'wordcloud'    => true,
                    ],
                    'bundle' => 'periodicals-overview',
                ],
                'blockCss'   => 'periodicals-overview',
                'blockClass' => 'iwac-vis-periodicals-overview',
                'loading'    => 'Loading periodicals overview', // @translate
            ],
        ],
        'press-bylines' => [
            'invokable'   => 'pressBylines',
            'class'       => BlockLayout\PressBylines::class,
            'label'       => 'Press Bylines', // @translate
            'description' => 'Explore recorded journalists and press agencies, the share of articles with a byline, and their representation over time. A missing byline may reflect incomplete cataloguing.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'press-bylines',
                    'needs' => [
                        'chartOptions' => true,
                    ],
                    'bundle' => 'press-bylines',
                ],
                'blockClass' => 'iwac-vis-press-bylines',
                'loading'    => 'Loading press bylines', // @translate
            ],
        ],
        'press-reprints' => [
            'invokable'   => 'pressReprints',
            'class'       => BlockLayout\PressReprints::class,
            'label'       => 'Press Reprints', // @translate
            'description' => 'Find articles from different newspapers with highly similar AI text representations. These candidate pairs may indicate shared dispatches, communiqués or reprints; read both articles before concluding that copying occurred.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'press-reprints',
                    'needs' => [
                        'chartOptions' => true,
                        'table'        => true,
                    ],
                    'bundle' => 'press-reprints',
                ],
                'blockClass' => 'iwac-vis-reprints',
                'loading'    => 'Loading press reprints', // @translate
            ],
        ],
        'references-overview' => [
            'invokable'   => 'referencesOverview',
            'class'       => BlockLayout\ReferencesOverview::class,
            'label'       => 'References Overview', // @translate
            'description' => 'Explore the bibliography by publication date, type, language, associated country, author and subject. Additional views show authorship links, available full text, modelled themes and text similarity.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        'chartOptions' => true,
                        'maplibre'     => true,
                        // "Color by" switch on the semantic-landscape panel.
                        'facetButtons' => true,
                    ],
                    'bundle' => 'references-overview',
                ],
                'blockClass' => 'iwac-vis-references-overview',
                'loading'    => 'Loading references overview', // @translate
            ],
        ],
        'scary-terms' => [
            'invokable'   => 'scaryTerms',
            'class'       => BlockLayout\ScaryTerms::class,
            'label'       => 'Scary Terms', // @translate
            'description' => 'Explore selected vocabulary associated with radicalism and extremism in newspaper articles: occurrences, trends, countries, term pairs, surrounding vocabulary and tagged places. Counts describe language use, not the extremism of the people discussed.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'scary-terms',
                    'needs' => [
                        'chartOptions' => true,
                        // Word cloud view (issue #4) — echarts-wordcloud + the shared
                        // facet bar; Map view (issue #3) — the MapLibre stack.
                        'wordcloud'    => true,
                        'facetButtons' => true,
                        'maplibre'     => true,
                        // Trends view (issue #2) — the annotated time series now lives
                        // in shared/, shared with the Laïcité block (issue #14).
                        'timeline'     => true,
                    ],
                    // The bundle: i18n strings + stateless builders + the three view
                    // modules + the controls row, then the orchestrator (which aliases
                    // the builders and reads the registered translations). The file
                    // list and its order live in asset/js/bundles.json.
                    'bundle' => 'scary-terms',
                ],
                'blockClass' => 'iwac-vis-scary',
                'loading'    => 'Loading scary terms', // @translate
                'siteBase'   => true,
            ],
        ],
        'semantic-landscape' => [
            'invokable'   => 'semanticLandscape',
            'class'       => BlockLayout\SemanticLandscape::class,
            'label'       => 'Semantic Landscape', // @translate
            'description' => 'Explore newspaper articles arranged by an AI comparison of their full texts, with colours for country, decade or modelled topic. Nearby points suggest texts to compare; distances are approximate.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        // C.landscape — the UMAP scatter option the three landscape
                        // views share.
                        'chartOptions' => true,
                        'facetButtons' => true,
                    ],
                    'bundle' => 'semantic-landscape',
                ],
                'blockClass' => 'iwac-vis-semantic-landscape',
                'loading'    => 'Loading semantic landscape', // @translate
            ],
        ],
        'sentiment-atlas' => [
            'invokable'   => 'sentimentAtlas',
            'class'       => BlockLayout\SentimentAtlas::class,
            'label'       => 'Sentiment Atlas', // @translate
            'description' => 'Compare AI assessments of tone towards Islam and Muslims, their prominence in articles, and subjectivity. Views show changes over time, differences between sources and model agreement. Ratings require checking against the texts, especially for subjectivity.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'needs' => [
                        'chartOptions' => true,
                        'facetButtons' => true,
                    ],
                    'bundle' => 'sentiment-atlas',
                ],
                'blockClass' => 'iwac-vis-sentiment-atlas',
                'loading'    => 'Loading sentiment atlas', // @translate
            ],
        ],
        'spatial-exploration' => [
            'invokable'   => 'spatialExploration',
            'class'       => BlockLayout\SpatialExploration::class,
            'label'       => 'Spatial Exploration', // @translate
            'description' => 'Map places linked through catalogue records, with filters for countries and associated people, organisations, subjects or events. Only places with coordinates appear; the map does not include every location mentioned in the texts.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'spatial-exploration',
                    'needs' => [
                        'maplibre' => true,
                    ],
                    'bundle' => 'spatial-exploration',
                ],
                'blockClass' => 'iwac-vis-spatial',
                'loading'    => 'Loading spatial exploration', // @translate
            ],
        ],
        'term-trends' => [
            'invokable'   => 'termTrends',
            'class'       => BlockLayout\TermTrends::class,
            'label'       => 'Term Trends', // @translate
            'description' => 'Compare the number or share of dated newspaper articles containing selected words. Search the frequent-word vocabulary and compare up to eight terms. Each word counts once per article, and only articles with usable processed text enter the calculation.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'term-trends',
                    'needs' => [
                        'chartOptions' => true,
                    ],
                    'bundle' => 'term-trends',
                ],
                'blockClass' => 'iwac-vis-ngram',
                'loading'    => 'Loading term trends', // @translate
            ],
        ],
        'topic-explorer' => [
            'invokable'   => 'topicExplorer',
            'class'       => BlockLayout\TopicExplorer::class,
            'label'       => 'Topic Explorer', // @translate
            'description' => 'Explore 30 themes identified in newspaper articles by a statistical topic model. Select a theme to examine its publication dates, countries, newspapers and example articles. Modelled themes differ from catalogue subject tags.', // @translate
            'embeddable'  => true,
            'shell'       => [
                'assets' => [
                    'blockCss' => 'topic-explorer',
                    'needs' => [
                        'chartOptions' => true,
                        'layout'       => true,
                        // Weighting switch on the topics-over-time panel (dominant
                        // topic vs probability-weighted prevalence).
                        'facetButtons' => true,
                        // The topic map is drawn by calling the BUILDER directly
                        // (`ns.chartOptions.treemap`, which `chartOptions` above already
                        // supplies), not by dispatching a layout slot. The per-topic
                        // detail slots (calendar heatmap, horizontal bar, similar items)
                        // are what `layout` is for: the shared-layout bundle carries
                        // every renderer.
                    ],
                    'bundle' => 'topic-explorer',
                ],
                'blockClass'   => 'iwac-vis-topic-explorer',
                'loading'      => 'Loading Topic Explorer', // @translate
                'loadingClass' => 'iwac-vis-topic-explorer__loading',
            ],
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
