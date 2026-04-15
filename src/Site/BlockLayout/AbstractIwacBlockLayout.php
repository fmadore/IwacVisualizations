<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

/**
 * Shared scaffolding for IWAC page blocks.
 *
 * Every IWAC block is zero-configuration: form() renders a description,
 * render() calls a template partial with the block as the only argument.
 * Subclasses override the three abstract metadata accessors.
 */
abstract class AbstractIwacBlockLayout extends AbstractBlockLayout
{
    abstract protected function label(): string;
    abstract protected function description(): string;
    abstract protected function templateViewScript(): string;

    public function getLabel()
    {
        return $this->label();
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        SitePageRepresentation $page = null, SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate($this->description()) . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
        ]);
    }
}
