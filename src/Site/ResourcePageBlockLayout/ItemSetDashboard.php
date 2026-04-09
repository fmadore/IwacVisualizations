<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class ItemSetDashboard implements ResourcePageBlockLayoutInterface
{
    public function getLabel(): string
    {
        return 'Item Set Dashboard'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['item_sets'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        return $view->partial('common/resource-page-block-layout/item-set-dashboard', [
            'resource' => $resource,
        ]);
    }
}
