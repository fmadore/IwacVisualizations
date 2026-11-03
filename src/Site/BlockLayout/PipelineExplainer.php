<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Site\ConfiguredEmbed;
use IwacVisualizations\Site\PipelinePresets;
use Laminas\Form\Element\Select;
use Laminas\View\HelperPluginManager;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

/**
 * Pipeline explainer page block: a short animated diagram of one IWAC
 * processing workflow, chosen by the editor from `PipelinePresets`.
 *
 * Two settings: which preset, and the heading level of its title, so the
 * block fits the outline of the page text it is placed among. It reads no
 * data and requests nothing — the diagram is educational, drawn from the
 * preset's own words. An embed names the preset (`?preset=ocr`) and takes
 * the default heading level.
 */
class PipelineExplainer extends AbstractIwacBlockLayout implements ConfiguredEmbed
{
    const SLUG = 'pipeline-explainer';

    public static function embedVariants(HelperPluginManager $helpers): array
    {
        $translate = $helpers->get('translate');
        $variants = [];
        foreach (PipelinePresets::LABELS as $id => $label) {
            $variants[$id] = (string) $translate($label);
        }
        return $variants;
    }

    public static function embedVariables(HelperPluginManager $helpers, string $value): ?array
    {
        // resolve() would turn a typo into the default preset; an embed URL
        // that names nothing real is a 404, not a different diagram.
        if (!isset(PipelinePresets::LABELS[$value])) {
            return null;
        }
        $translate = $helpers->get('translate');
        return [
            'content' => PipelinePresets::content($value, '',
                static fn (string $text): string => (string) $translate($text)),
            'instance' => 'pipeline-' . $value,
        ];
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $presets = [];
        foreach (PipelinePresets::LABELS as $id => $label) {
            $presets[$id] = $view->translate($label);
        }
        $preset = new Select('o:block[__blockIndex__][o:data][preset]');
        $preset->setLabel('Workflow'); // @translate
        $preset->setOption('info', 'Which processing workflow the diagram explains.'); // @translate
        $preset->setValueOptions($presets);
        $preset->setValue(PipelinePresets::resolve($block ? (string) $block->dataValue('preset', '') : null));

        $levels = [];
        foreach (PipelinePresets::HEADING_LEVELS as $level) {
            $levels[$level] = strtoupper($level);
        }
        $heading = new Select('o:block[__blockIndex__][o:data][heading_level]');
        $heading->setLabel('Title heading level'); // @translate
        $heading->setOption('info', 'Match the page outline: one level below the heading of the section the block sits in.'); // @translate
        $heading->setValueOptions($levels);
        $heading->setValue(PipelinePresets::headingLevel($block ? (string) $block->dataValue('heading_level', '') : null));

        return parent::form($view, $site, $page, $block) . $view->formRow($preset) . $view->formRow($heading);
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        $content = PipelinePresets::content(
            (string) $block->dataValue('preset', ''),
            (string) $block->dataValue('heading_level', ''),
            static fn (string $text): string => $view->translate($text)
        );
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
            'content' => $content,
            'instance' => 'pipeline-' . $block->id(),
        ]);
    }
}
