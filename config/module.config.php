<?php
namespace IwacVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'compareNewspapers' => Site\BlockLayout\CompareNewspapers::class,
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'indexOverview' => Site\BlockLayout\IndexOverview::class,
            'periodicalsOverview' => Site\BlockLayout\PeriodicalsOverview::class,
            'referencesOverview' => Site\BlockLayout\ReferencesOverview::class,
            'scaryTerms' => Site\BlockLayout\ScaryTerms::class,
            'topicExplorer' => Site\BlockLayout\TopicExplorer::class,
        ],
    ],
    'resource_page_block_layouts' => [
        'invokables' => [
            'visualizations' => Site\ResourcePageBlockLayout\Visualizations::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
        ],
    ],
    'view_manager' => [
        'template_path_stack' => [
            dirname(__DIR__) . '/view',
        ],
    ],
];
