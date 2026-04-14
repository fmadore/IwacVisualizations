<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class ScaryTerms extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Scary Terms'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        SitePageRepresentation $page = null, SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate(
            'Bar chart of radical / extremism-related terms across the IWAC collection, with bar chart race, by-country, and global views. No configuration needed.'
        ) . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/scary-terms')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
