<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Site\CollectionIntroText;
use Laminas\Form\Element\Select;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

/**
 * Collection Introduction page block: a short guided introduction to IWAC in
 * four chapters, its figures read from the Collection Overview's data.
 *
 * One setting, the heading level of its title, so the block fits the outline
 * of the page it opens. It names nothing else, so its embed needs no
 * parameter and takes the default level.
 */
class CollectionIntro extends AbstractIwacBlockLayout
{
    const SLUG = 'collection-intro';

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $levels = [];
        foreach (CollectionIntroText::HEADING_LEVELS as $level) {
            $levels[$level] = strtoupper($level);
        }
        $heading = new Select('o:block[__blockIndex__][o:data][heading_level]');
        $heading->setLabel('Title heading level'); // @translate
        $heading->setOption('info', 'Match the page outline: H2 when the block opens the page, one level below the heading of the section it sits in otherwise.'); // @translate
        $heading->setValueOptions($levels);
        $heading->setValue(CollectionIntroText::headingLevel($block ? (string) $block->dataValue('heading_level', '') : null));

        return parent::form($view, $site, $page, $block) . $view->formRow($heading);
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        $content = CollectionIntroText::content(
            (string) $block->dataValue('heading_level', ''),
            static fn (string $text): string => $view->translate($text)
        );
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
            'content' => $content,
            'instance' => 'collection-intro-' . $block->id(),
        ]);
    }
}
