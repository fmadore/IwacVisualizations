<?php
namespace IwacVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'compareNewspapers' => Site\BlockLayout\CompareNewspapers::class,
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'entityNetworks' => Site\BlockLayout\EntityNetworks::class,
            'indexOverview' => Site\BlockLayout\IndexOverview::class,
            'lexicalMetrics' => Site\BlockLayout\LexicalMetrics::class,
            'periodicalsOverview' => Site\BlockLayout\PeriodicalsOverview::class,
            'referencesOverview' => Site\BlockLayout\ReferencesOverview::class,
            'scaryTerms' => Site\BlockLayout\ScaryTerms::class,
            'semanticLandscape' => Site\BlockLayout\SemanticLandscape::class,
            'sentimentAtlas' => Site\BlockLayout\SentimentAtlas::class,
            'spatialExploration' => Site\BlockLayout\SpatialExploration::class,
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
            'IwacVisualizations\Controller\Admin\Data' => Controller\Admin\DataController::class,
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
];
