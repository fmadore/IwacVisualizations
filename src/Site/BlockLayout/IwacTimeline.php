<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Site\ConfiguredEmbed;
use IwacVisualizations\Site\Locale;
use IwacVisualizations\Timeline\Catalog;
use IwacVisualizations\Timeline\Sources;
use Laminas\Form\Element\Select;
use Laminas\Form\Element\Text;
use Laminas\View\HelperPluginManager;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

/**
 * An embed names the timeline (`?timeline=hajj-bf`) and opens it in the
 * site's language — or the other one, when the timeline has only that —
 * on its narrative view at the title slide.
 */
class IwacTimeline extends AbstractIwacBlockLayout implements ConfiguredEmbed
{
    const SLUG = 'iwac-timeline';

    /**
     * `en` or `fr`: the site's language by the rule the embed layout uses for
     * `<html lang>` (Site\Locale — the site's setting, else the
     * installation's), so the timeline speaks the language of the page
     * around it.
     */
    private static function siteLanguage(HelperPluginManager $helpers): string
    {
        return Locale::language($helpers->get('siteSetting')('locale'), $helpers->get('setting')('locale'));
    }

    /**
     * The timeline in `$language`, else in the other one: a timeline that
     * exists in one language only is better read in it than replaced by the
     * "temporarily unavailable" note. The page block and the embed share it.
     */
    private static function loadEither(Catalog $catalog, string $slug, string $language): ?array
    {
        return $catalog->load($slug, $language) ?? $catalog->load($slug, Locale::other($language));
    }

    public static function embedVariants(HelperPluginManager $helpers): array
    {
        $language = self::siteLanguage($helpers);
        $variants = [];
        foreach ($helpers->get('iwacTimelineData')()->entries() as $slug => $entry) {
            $titles = array_filter(array_column($entry['locales'], 'title'), 'is_string');
            $variants[$slug] = (string) ($entry['locales'][$language]['title'] ?? implode(' / ', $titles) ?: $slug);
        }
        return $variants;
    }

    public static function embedVariables(HelperPluginManager $helpers, string $value): ?array
    {
        if (!Catalog::validId($value)) {
            return null;
        }
        $timeline = self::loadEither($helpers->get('iwacTimelineData')(), $value, self::siteLanguage($helpers));
        if (!$timeline) {
            return null;
        }
        return [
            'timeline' => $timeline,
            'instance' => 'embed-' . $value,
            'startSlide' => 'intro',
            'layout' => 'narrative',
        ];
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $catalog = $view->iwacTimelineData();
        $options = ['' => $view->translate('Choose a timeline')];
        foreach ($catalog->entries() as $slug => $entry) {
            $names = array_column($entry['locales'], 'title');
            $options[$slug] = implode(' / ', $names);
        }
        $selected = $block ? (string) $block->dataValue('timeline', '') : '';
        if ($selected !== '' && !isset($options[$selected])) {
            // Saving an old page before the new data sync must not erase its selection.
            $options[$selected] = $selected . ' (' . $view->translate('data unavailable') . ')';
        }
        $prefix = 'o:block[__blockIndex__][o:data]';
        $fields = [];
        $fields['timeline'] = (new Select($prefix . '[timeline]'))
            ->setLabel('Timeline')->setValueOptions($options); // @translate
        $fields['locale'] = (new Select($prefix . '[locale]'))->setLabel('Content language') // @translate
            ->setValueOptions(['auto' => $view->translate('Site language'), 'en' => 'English', 'fr' => 'Français']);
        $fields['layout'] = (new Select($prefix . '[layout]'))->setLabel('Default view') // @translate
            ->setValueOptions(['narrative' => $view->translate('Narrative'), 'list' => $view->translate('All events')]);
        $fields['start_slide'] = (new Text($prefix . '[start_slide]'))->setLabel('Opening event ID (optional)'); // @translate
        $html = '<p>' . $view->escapeHtml($view->translate($this->row()['description'])) . '</p>';
        if (!$catalog->entries()) {
            $html .= '<p>' . $view->escapeHtml($view->translate('Pull the latest visualization data to make timelines available.')) . '</p>';
        }
        foreach ($fields as $key => $field) {
            $fallback = ['locale' => 'auto', 'layout' => 'narrative'][$key] ?? '';
            $field->setValue($block ? $block->dataValue($key, $fallback) : $fallback);
            $html .= $view->formRow($field);
        }
        return $html;
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block, $templateViewScript = null)
    {
        $slug = (string) $block->dataValue('timeline', '');
        $locale = (string) $block->dataValue('locale', 'auto');
        if (!in_array($locale, Locale::LANGUAGES, true)) {
            $locale = self::siteLanguage($view->getHelperPluginManager());
        }
        $start = (string) $block->dataValue('start_slide', 'intro');
        $timeline = Catalog::validId($slug) ? self::loadEither($view->iwacTimelineData(), $slug, $locale) : null;
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
            'timeline' => $timeline,
            'instance' => 'block-' . $block->id(),
            'startSlide' => Catalog::validId($start) ? $start : 'intro',
            'layout' => $block->dataValue('layout', 'narrative') === 'list' ? 'list' : 'narrative',
        ] + ($timeline ? self::sourceVariables($view, $timeline) : []));
    }

    /**
     * The source list under the timeline: the items the events' captions
     * cite, read through the API (so a private item stays out), and the
     * site theme's masonry scripts when it ships them.
     */
    private static function sourceVariables(PhpRenderer $view, array $timeline): array
    {
        $helpers = $view->getHelperPluginManager();
        // IWAC-theme's ResourceLanguage tags a French title on the English
        // site; another theme has no such helper, and the titles go untagged.
        $language = $helpers->has('ResourceLanguage') ? $helpers->get('ResourceLanguage') : null;
        $site = $view->currentSite();
        return [
            'sources' => Sources::cards($timeline, $view->api(), $timeline['locale'], $language),
            'sourceScripts' => Sources::themeScripts($site && defined('OMEKA_PATH') ? OMEKA_PATH . '/themes/' . $site->theme() : null),
        ];
    }
}
