<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class ReferencesOverview extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'References Overview'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        SitePageRepresentation $page = null, SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Bibliographic references overview: timeline, types, top authors, and top subjects. Data is fetched live from Hugging Face. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/references-overview')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
