<?php
namespace IwacVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'compareProjects' => Site\BlockLayout\CompareProjects::class,
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'referencesOverview' => Site\BlockLayout\ReferencesOverview::class,
        ],
    ],
    'resource_page_block_layouts' => [
        'invokables' => [
            'knowledgeGraph' => Site\ResourcePageBlockLayout\KnowledgeGraph::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
            'linkedItemsDashboard' => Site\ResourcePageBlockLayout\LinkedItemsDashboard::class,
            'personDashboard' => Site\ResourcePageBlockLayout\PersonDashboard::class,
        ],
    ],
    'view_manager' => [
        'template_path_stack' => [
            dirname(__DIR__) . '/view',
        ],
    ],
];
