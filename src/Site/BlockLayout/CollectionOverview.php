<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class CollectionOverview extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Collection Overview'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        SitePageRepresentation $page = null, SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Aggregate visualizations across the entire collection. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/collection-overview')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
