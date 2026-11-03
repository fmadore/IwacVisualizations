<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class ItemSetDashboard implements ResourcePageBlockLayoutInterface
{
    /** Also what the embed route renders for `/iwac-embed/item-set/<id>`. */
    const PARTIAL = 'common/resource-page-block-layout/item-set-dashboard';

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
        return $view->partial(self::PARTIAL, [
            'resource' => $resource,
        ]);
    }
}
