<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use Laminas\Form\Element\MultiCheckbox;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

/**
 * Albani Zaria sermons page block (issue #31). Label and description
 * resolve from `IwacVisualizations\Site\BlockRegistry::BLOCKS['albani-sermons']`.
 *
 * Its one setting is which sections it shows, so the exhibition can be
 * spread over a page and its sub-pages instead of one very long scroll.
 * Nothing ticked means every section: a block saved before the setting
 * existed renders as it always did.
 *
 * A block showing only some sections also learns where the others are: it
 * reads every page of its site for Albani blocks and hands the template a
 * list of pages and the sections each shows. The contents, the "How this
 * was made" link and the previous/next links at the foot use it, so an
 * editor only places blocks and never types a link. The embed route has no
 * block and renders every section, as before.
 */
class AlbaniSermons extends AbstractIwacBlockLayout
{
    const SLUG = 'albani-sermons';

    /**
     * The sections in page order. Keys must match `SECTIONS` in
     * asset/js/charts/albani-sermons.js (tests/php/run.php checks it); the
     * labels are the sections' English headings.
     */
    const SECTIONS = [
        'corpus'     => 'The recordings', // @translate
        'vocabulary' => 'Vocabulary', // @translate
        'entities'   => 'People and places', // @translate
        'youth'      => 'Youth', // @translate
        'politics'   => 'Democracy and politics', // @translate
        'overlap'    => 'Where youth meets politics', // @translate
        'keyness'    => 'What sets a recording apart', // @translate
        'rhetoric'   => 'Style and rhetoric', // @translate
        'method'     => 'How this exhibition was made', // @translate
    ];

    /** The block layout name Omeka stores on each block (the invokable). */
    const LAYOUT = 'albaniSermons';

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $options = [];
        foreach (self::SECTIONS as $key => $label) {
            $options[$key] = $view->translate($label);
        }

        $select = new MultiCheckbox('o:block[__blockIndex__][o:data][sections]');
        $select->setLabel('Sections'); // @translate
        $select->setOption('info', 'Which sections this block shows. Leave all unticked to show the whole '
            . 'exhibition. To spread it over sub-pages, add this block to each page with the sections that '
            . 'page should show: the contents and the links between pages follow by themselves. The '
            . 'introduction and the figures appear with "The recordings".'); // @translate
        $select->setValueOptions($options);
        // A saved block that ticked everything reads back as "all", so the
        // form shows what is stored rather than an equivalent.
        $select->setValue(self::sectionsOf($block));
        // Nothing ticked is a valid answer ("all"), so the element must not
        // insist on a value.
        $select->setUseHiddenElement(true);

        return parent::form($view, $site, $page, $block) . $view->formRow($select);
    }

    /**
     * The sections a block shows, in page order, with keys the JS no longer
     * knows dropped. An empty list means every section.
     *
     * @return string[]
     */
    public static function sectionsOf(?object $block): array
    {
        $value = $block && method_exists($block, 'dataValue') ? $block->dataValue('sections', []) : [];
        $value = is_array($value) ? array_map('strval', $value) : [];
        $keys = array_values(array_intersect(array_keys(self::SECTIONS), $value));
        return count($keys) === count(self::SECTIONS) ? [] : $keys;
    }

    /**
     * Order and tidy the pages that hold Albani blocks: each page's sections
     * as one list (several blocks on a page add up; "all" is every key),
     * pages with nothing dropped, and the pages sorted by their first
     * section so the previous/next links follow the exhibition's order.
     *
     * Pure, so tests/php/run.php can exercise it without Omeka.
     *
     * @param array<int, array{url: string, title: string, current: bool, sections: array<int, string[]>}> $pages
     *        each page's blocks' section lists, as `sectionsOf()` returns them
     * @return array<int, array{url: string, title: string, current: bool, sections: string[]}>
     */
    public static function pageMap(array $pages): array
    {
        $order = array_flip(array_keys(self::SECTIONS));
        $out = [];
        foreach ($pages as $page) {
            $keys = [];
            foreach ($page['sections'] as $blockSections) {
                $keys = array_merge($keys, $blockSections === [] ? array_keys(self::SECTIONS) : $blockSections);
            }
            $keys = array_values(array_intersect(array_keys(self::SECTIONS), $keys));
            if ($keys === []) {
                continue;
            }
            $out[] = [
                'url'      => $page['url'],
                'title'    => $page['title'],
                'current'  => $page['current'],
                'sections' => $keys,
            ];
        }
        usort($out, function (array $a, array $b) use ($order): int {
            return $order[$a['sections'][0]] <=> $order[$b['sections'][0]];
        });
        return $out;
    }

    /**
     * The pages of this block's site that hold Albani blocks, for a block
     * that shows only some sections. Empty for a block that shows them all,
     * which needs no links elsewhere, and on any failure: the block then
     * links only within its own page.
     *
     * @return array<int, array{url: string, title: string, current: bool, sections: string[]}>
     */
    private function sitePages(PhpRenderer $view, SitePageBlockRepresentation $block): array
    {
        if (self::sectionsOf($block) === []) {
            return [];
        }
        // Omeka 4.2.1 documents page() as returning the site; it returns the
        // page. Checked, so PHPStan reads the real type and a future core
        // that changes it degrades to same-page links instead of a fatal.
        $current = $block->page();
        if (!$current instanceof SitePageRepresentation) {
            return [];
        }
        try {
            $pages = $view->api()->search('site_pages', ['site_id' => $current->site()->id()])->getContent();
        } catch (\Throwable $e) {
            return [];
        }
        $found = [];
        foreach ($pages as $page) {
            $sections = [];
            foreach ($page->blocks() as $other) {
                if ($other->layout() === self::LAYOUT) {
                    $sections[] = self::sectionsOf($other);
                }
            }
            if ($sections !== []) {
                $found[] = [
                    'url'      => $page->siteUrl(),
                    'title'    => $page->title(),
                    'current'  => $page->id() === $current->id(),
                    'sections' => $sections,
                ];
            }
        }
        return self::pageMap($found);
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block'    => $block,
            'sections' => self::sectionsOf($block),
            'pages'    => $this->sitePages($view, $block),
        ]);
    }
}
