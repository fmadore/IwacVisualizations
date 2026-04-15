<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class IndexOverview extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Index Overview'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        SitePageRepresentation $page = null, SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Explore authority entities (persons, places, organisations, events, topics) and Dublin Core Subject + Spatial Coverage prevalence over time. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/index-overview')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
