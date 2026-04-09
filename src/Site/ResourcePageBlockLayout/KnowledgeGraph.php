<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class KnowledgeGraph implements ResourcePageBlockLayoutInterface
{
    public function getLabel(): string
    {
        return 'Knowledge Graph'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        return $view->partial('common/resource-page-block-layout/knowledge-graph', [
            'resource' => $resource,
        ]);
    }
}
