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
 * editor only places blocks and never types a link. Ticking "A summary of
 * each page" (`overview`) makes a block the landing page: a card for every
 * other page. The embed route has no block and renders every section.
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

    /**
     * Not a section: a summary card for each other page of the exhibition,
     * which makes the block a landing page. Listed first in the form; the
     * JS knows it as `OVERVIEW`.
     */
    const OVERVIEW = 'overview';

    /**
     * The layout names a stored block may carry: the module registers
     * `iwac-albaniSermons` and keeps the bare name as an alias for blocks
     * saved before the rename (config/module.config.php). v2.7.0 compared
     * against the bare name alone, so no page ever found another.
     */
    const LAYOUTS = ['iwac-albaniSermons', 'albaniSermons'];

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $options = [self::OVERVIEW => $view->translate('A summary of each page (for a landing page)')]; // @translate
        foreach (self::SECTIONS as $key => $label) {
            $options[$key] = $view->translate($label);
        }

        $select = new MultiCheckbox('o:block[__blockIndex__][o:data][sections]');
        $select->setLabel('Sections'); // @translate
        $select->setOption('info', 'Which sections this block shows. Leave all unticked to show the whole '
            . 'exhibition. To spread it over sub-pages, add this block to each page with the sections that '
            . 'page should show: the contents and the links between pages follow by themselves. For a '
            . 'landing page, tick "A summary of each page": it shows the introduction, the figures and a '
            . 'card for every other page.'); // @translate
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
     * What a block shows, in page order — `overview` first when ticked, then
     * its sections — with keys the JS no longer knows dropped. An empty list
     * means every section (nothing ticked, or every section and no summary).
     *
     * @return string[]
     */
    public static function sectionsOf(?object $block): array
    {
        $value = $block && method_exists($block, 'dataValue') ? $block->dataValue('sections', []) : [];
        $value = is_array($value) ? array_map('strval', $value) : [];
        $keys = array_values(array_intersect(array_keys(self::SECTIONS), $value));
        $overview = in_array(self::OVERVIEW, $value, true);
        if (!$overview && count($keys) === count(self::SECTIONS)) {
            return [];
        }
        return $overview ? array_merge([self::OVERVIEW], $keys) : $keys;
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
        // The summary sorts first: a landing page opens the exhibition.
        $known = array_merge([self::OVERVIEW], array_keys(self::SECTIONS));
        $order = array_flip($known);
        $out = [];
        foreach ($pages as $page) {
            $keys = [];
            foreach ($page['sections'] as $blockSections) {
                $keys = array_merge($keys, $blockSections === [] ? array_keys(self::SECTIONS) : $blockSections);
            }
            $keys = array_values(array_intersect($known, $keys));
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
                if (in_array($other->layout(), self::LAYOUTS, true)) {
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
