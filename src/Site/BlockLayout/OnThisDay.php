<?php
namespace IwacVisualizations\Site\BlockLayout;

use Laminas\Form\Element\Select;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

/**
 * On This Day page block. Label, description and template all resolve from
 * `IwacVisualizations\Site\BlockRegistry::BLOCKS['on-this-day']`.
 *
 * The one IWAC block that takes a setting: which of its three layouts it
 * opens on. Readers can still switch — the block renders the same switcher
 * whatever the setting, and remembers their choice — so this is a default,
 * not a lock. A homepage usually wants the quiet register; a
 * collection-highlights page may want the clippings wall.
 */
class OnThisDay extends AbstractIwacBlockLayout
{
    const SLUG = 'on-this-day';

    /** Keys must match `LAYOUTS` in asset/js/charts/on-this-day.js. */
    const LAYOUTS = [
        'register'  => 'Register — ruled rows, six documents', // @translate
        'decades'   => 'Decades — five documents along a time axis', // @translate
        'clippings' => 'Clippings — eight documents in a mosaic', // @translate
    ];

    const DEFAULT_LAYOUT = 'register';

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        // The LAYOUTS values are marked @translate for extraction, but nothing
        // translates a select's value options for us — do it here.
        $options = [];
        foreach (self::LAYOUTS as $key => $label) {
            $options[$key] = $view->translate($label);
        }

        $select = new Select('o:block[__blockIndex__][o:data][layout]');
        $select->setLabel('Default layout'); // @translate
        $select->setOption('info', 'Which layout the block opens on. Visitors can '
            . 'switch between all three; their choice is remembered.'); // @translate
        $select->setValueOptions($options);
        $select->setValue($this->layout($block));

        return '<p>' . $view->translate($this->row()['description']) . '</p>'
            . $view->formRow($select);
    }

    /**
     * The configured layout, falling back to the default for a block saved
     * before this setting existed or carrying a key the JS no longer knows.
     */
    public function layout(?SitePageBlockRepresentation $block = null): string
    {
        $value = $block ? (string) $block->dataValue('layout', '') : '';
        return isset(self::LAYOUTS[$value]) ? $value : self::DEFAULT_LAYOUT;
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block'  => $block,
            'layout' => $this->layout($block),
        ]);
    }
}
