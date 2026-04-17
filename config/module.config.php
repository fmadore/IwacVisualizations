<?php
namespace IwacVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'compareProjects' => Site\BlockLayout\CompareProjects::class,
            'compareNewspapers' => Site\BlockLayout\CompareNewspapers::class,
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'indexOverview' => Site\BlockLayout\IndexOverview::class,
            'referencesOverview' => Site\BlockLayout\ReferencesOverview::class,
            'scaryTerms' => Site\BlockLayout\ScaryTerms::class,
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
