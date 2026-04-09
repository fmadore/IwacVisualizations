<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class LinkedItemsDashboard implements ResourcePageBlockLayoutInterface
{
    public function getLabel(): string
    {
        return 'Visualizations'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        return $view->partial('common/resource-page-block-layout/linked-items-dashboard', [
            'resource' => $resource,
        ]);
    }
}
