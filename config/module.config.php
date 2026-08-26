<?php
namespace IwacVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'audiovisualOverview' => Site\BlockLayout\AudiovisualOverview::class,
            'compareNewspapers' => Site\BlockLayout\CompareNewspapers::class,
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'distinctiveVocabulary' => Site\BlockLayout\DistinctiveVocabulary::class,
            'entityNetworks' => Site\BlockLayout\EntityNetworks::class,
            'indexOverview' => Site\BlockLayout\IndexOverview::class,
            'laicite' => Site\BlockLayout\Laicite::class,
            'lexicalMetrics' => Site\BlockLayout\LexicalMetrics::class,
            'onThisDay' => Site\BlockLayout\OnThisDay::class,
            'orgCooccurrence' => Site\BlockLayout\OrgCooccurrence::class,
            'periodicalsLandscape' => Site\BlockLayout\PeriodicalsLandscape::class,
            'periodicalsOverview' => Site\BlockLayout\PeriodicalsOverview::class,
            'pressBylines' => Site\BlockLayout\PressBylines::class,
            'pressReprints' => Site\BlockLayout\PressReprints::class,
            'referencesOverview' => Site\BlockLayout\ReferencesOverview::class,
            'scaryTerms' => Site\BlockLayout\ScaryTerms::class,
            'semanticLandscape' => Site\BlockLayout\SemanticLandscape::class,
            'sentimentAtlas' => Site\BlockLayout\SentimentAtlas::class,
            'spatialExploration' => Site\BlockLayout\SpatialExploration::class,
            'termTrends' => Site\BlockLayout\TermTrends::class,
            'topicExplorer' => Site\BlockLayout\TopicExplorer::class,
        ],
    ],
    'resource_page_block_layouts' => [
        'invokables' => [
            'visualizations' => Site\ResourcePageBlockLayout\Visualizations::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
        ],
    ],
    'controllers' => [
        'invokables' => [
            'IwacVisualizations\Controller\Site\Embed' => Controller\Site\EmbedController::class,
        ],
        'factories' => [
            // Service NAME unchanged (the ACL grant in Module::onBootstrap and
            // the admin navigation `resource` reference it) — only the
            // instantiation moved to a factory so the file store can be
            // injected for the corpus-health read (ROADMAP 9.10).
            'IwacVisualizations\Controller\Admin\Data' => Service\Controller\Admin\DataControllerFactory::class,
        ],
    ],
    'navigation' => [
        // Left-sidebar admin entry → /admin/iwac-visualizations. The `resource`
        // must equal the controller service name above and be ACL-allowed in
        // Module::onBootstrap, or the link is hidden / 403s.
        'AdminModule' => [
            [
                'label' => 'IWAC Visualizations', // @translate
                'route' => 'admin/iwac-visualizations',
                'resource' => 'IwacVisualizations\Controller\Admin\Data',
            ],
        ],
    ],
    'router' => [
        'routes' => [
            // Admin data-sync page, merged into Omeka's core `admin` route tree:
            //   /admin/iwac-visualizations        → DataController::indexAction
            //   /admin/iwac-visualizations/sync   → DataController::syncAction (POST)
            'admin' => [
                'child_routes' => [
                    'iwac-visualizations' => [
                        'type' => \Laminas\Router\Http\Literal::class,
                        'options' => [
                            'route' => '/iwac-visualizations',
                            'defaults' => [
                                '__NAMESPACE__' => 'IwacVisualizations\Controller\Admin',
                                'controller' => 'Data',
                                'action' => 'index',
                            ],
                        ],
                        'may_terminate' => true,
                        'child_routes' => [
                            'sync' => [
                                'type' => \Laminas\Router\Http\Literal::class,
                                'options' => [
                                    'route' => '/sync',
                                    'defaults' => ['action' => 'sync'],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
            // Nested under Omeka's `site` route so the full path is
            // /s/:site-slug/iwac-embed[/...] and the `__SITE__` default is
            // inherited — that flag is what makes Omeka resolve the current
            // site + public theme for the request.
            'site' => [
                'child_routes' => [
                    'iwac-embed' => [
                        'type' => \Laminas\Router\Http\Literal::class,
                        'options' => [
                            'route' => '/iwac-embed',
                            'defaults' => [
                                '__NAMESPACE__' => 'IwacVisualizations\Controller\Site',
                                'controller' => 'Embed',
                                'action' => 'index',
                            ],
                        ],
                        'may_terminate' => true,
                        'child_routes' => [
                            'block' => [
                                'type' => \Laminas\Router\Http\Segment::class,
                                'options' => [
                                    'route' => '/:block',
                                    'constraints' => [
                                        'block' => '[a-z0-9-]+',
                                    ],
                                    'defaults' => [
                                        'action' => 'block',
                                    ],
                                ],
                                'may_terminate' => true,
                                'child_routes' => [
                                    // Single panel from a multi-panel block, e.g.
                                    // /iwac-embed/collection-overview/panel-3.
                                    // The panel slug is enumerated client-side
                                    // (asset/js/charts/shared/embed.js), so any
                                    // [a-z0-9.-] token is accepted here; an
                                    // unknown one quietly renders nothing.
                                    'panel' => [
                                        'type' => \Laminas\Router\Http\Segment::class,
                                        'options' => [
                                            'route' => '/:panel',
                                            'constraints' => [
                                                'panel' => '[a-zA-Z0-9._-]+',
                                            ],
                                            'defaults' => [
                                                'action' => 'block',
                                            ],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ],
    ],
    'view_manager' => [
        'template_path_stack' => [
            dirname(__DIR__) . '/view',
        ],
    ],
    /*
     * Register the module's gettext catalogue.
     *
     * Omeka S does NOT discover `language/*.mo` on its own — a module declares
     * the pattern here or its catalogue is never loaded, and every
     * `$this->translate()` in its templates silently renders the English
     * msgid. This block was simply absent, which is why the French site
     * rendered the AI-sentiment panel on every article page entirely in
     * English ("AI sentiment", "Polarity", "Very negative") while the charts
     * beside it were correctly French: the charts translate client-side
     * through `asset/js/iwac-i18n.js`, which needs no Omeka wiring, so the one
     * failure the module had was invisible everywhere the JS dictionary
     * covered — which is almost everywhere.
     *
     * `fr.po` has carried those strings since v0.11.0 and `fr.mo` matches it
     * (npm run lint:i18n-mo). Nothing was missing but the registration.
     *
     * `text_domain => null` puts them in the default domain, which is where
     * `$this->translate()` looks; `dirname(__DIR__)` resolves from this file
     * rather than OMEKA_PATH, so a non-standard install directory still works.
     */
    'translator' => [
        'translation_file_patterns' => [
            [
                'type' => 'gettext',
                'base_dir' => dirname(__DIR__) . '/language',
                'pattern' => '%s.mo',
                'text_domain' => null,
            ],
        ],
    ],
];
