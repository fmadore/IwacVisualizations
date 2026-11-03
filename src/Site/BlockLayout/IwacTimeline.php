<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Site\ConfiguredEmbed;
use IwacVisualizations\Timeline\Catalog;
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

    /** `en` or `fr` from a site locale such as `fr_FR`. */
    private static function language(string $siteLocale): string
    {
        return str_starts_with(strtolower($siteLocale), 'fr') ? 'fr' : 'en';
    }

    public static function embedVariants(HelperPluginManager $helpers): array
    {
        $language = self::language((string) $helpers->get('siteSetting')('locale', 'en'));
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
        $language = self::language((string) $helpers->get('siteSetting')('locale', 'en'));
        $catalog = $helpers->get('iwacTimelineData')();
        $timeline = $catalog->load($value, $language)
            ?? $catalog->load($value, $language === 'fr' ? 'en' : 'fr');
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
        if (!in_array($locale, ['en', 'fr'], true)) {
            $locale = self::language((string) $view->siteSetting('locale', 'en'));
        }
        $start = (string) $block->dataValue('start_slide', 'intro');
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
            'timeline' => Catalog::validId($slug) ? $view->iwacTimelineData()->load($slug, $locale) : null,
            'instance' => 'block-' . $block->id(),
            'startSlide' => Catalog::validId($start) ? $start : 'intro',
            'layout' => $block->dataValue('layout', 'narrative') === 'list' ? 'list' : 'narrative',
        ]);
    }
}
