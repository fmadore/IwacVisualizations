<?php
declare(strict_types=1);

namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Timeline\Catalog;
use Laminas\Form\Element\Select;
use Laminas\Form\Element\Text;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;

class IwacTimeline extends AbstractIwacBlockLayout
{
    const SLUG = 'iwac-timeline';

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
            $locale = str_starts_with(strtolower((string) $view->siteSetting('locale', 'en')), 'fr') ? 'fr' : 'en';
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
