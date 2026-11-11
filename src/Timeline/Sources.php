<?php
declare(strict_types=1);

namespace IwacVisualizations\Timeline;

use IwacVisualizations\Site\ItemValue;

/**
 * The documents a timeline draws on, for the source list under the block.
 *
 * The sheet stores media URLs, not item ids, but every image's caption cites
 * its document with a link to the IWAC item — `<a href="https://islam.zmo.de/
 * s/westafrica/item/8397">“El Hadj Alidou Kouanda…”, <i>Sidwaya</i>, …</a>` —
 * so the caption is where an event names its source. Links in the prose are
 * not sources: they point at index entries (places, people, organisations).
 * Resolving them needs neither the data generation nor a sheet column.
 */
final class Sources
{
    private const ITEM_LINK = '~href="https?://islam\.zmo\.de/s/[^/"]+/item/(\d+)/?"~';

    /**
     * IWAC-theme's masonry: MiniMasonry and the script that packs every
     * `.media-embed.layout-masonry` wall with it (the Media embed block's
     * "Masonry" template loads the same two). Without them the theme's
     * stylesheet still lays the wall out in CSS columns.
     */
    public const THEME_SCRIPTS = ['js/minimasonry.min.js', 'js/dist/media-masonry.min.js'];

    /**
     * The theme scripts to enqueue: both, when the site's theme ships them,
     * else none — a site on another theme gets no requests that would 404.
     *
     * @param string|null $themeRoot the site theme's directory on disk
     * @return string[] paths for `assetUrl()`, relative to the theme's asset/
     */
    public static function themeScripts(?string $themeRoot): array
    {
        if ($themeRoot === null) {
            return [];
        }
        foreach (self::THEME_SCRIPTS as $script) {
            if (!is_readable(rtrim($themeRoot, '/\\') . '/asset/' . $script)) {
                return [];
            }
        }
        return self::THEME_SCRIPTS;
    }

    /**
     * Item id => the ids of the events whose caption cites it, in the order
     * given (the first citation first).
     *
     * @param array{events?: array[]} $timeline
     * @return array<int, string[]>
     */
    public static function itemIds(array $timeline): array
    {
        $cited = [];
        foreach ($timeline['events'] ?? [] as $event) {
            $caption = (string) ($event['media']['captionHtml'] ?? '');
            if ($caption === '' || !preg_match_all(self::ITEM_LINK, $caption, $match)) {
                continue;
            }
            foreach ($match[1] as $id) {
                $cited[(int) $id][] = (string) $event['id'];
            }
        }
        return array_map(static function (array $events) {
            return array_values(array_unique($events));
        }, $cited);
    }

    /**
     * One card per cited item the API returns — a private or deleted item
     * simply drops out — ordered by the item's own date (a dateless item
     * last), then by its first citation.
     *
     * @param array{events?: array[]} $timeline
     * @param object $api Omeka's `api` view helper (its search())
     * @param callable|null $language item => BCP 47 code or '': IWAC-theme's
     *     ResourceLanguage helper when the site's theme has it, so a French
     *     title on the English site is read as French (WCAG 3.1.2)
     * @return array<int, array{id: int, url: string, title: string, lang: string, thumbnail: string, creators: string[], publisher: string, date: string, events: string[]}>
     */
    public static function cards(array $timeline, object $api, string $locale, ?callable $language = null): array
    {
        $cited = self::itemIds($timeline);
        if (!$cited) {
            return [];
        }
        $order = array_flip(array_keys($cited));
        $cards = [];
        foreach ($api->search('items', ['id' => array_keys($cited)])->getContent() as $item) {
            $id = (int) $item->id();
            if (!isset($cited[$id])) {
                continue;
            }
            $date = ItemValue::text($item->value('dcterms:date'));
            $cards[] = [
                'id' => $id,
                'url' => (string) $item->url(),
                'title' => (string) $item->displayTitle(),
                'lang' => $language ? self::subtag((string) $language($item)) : '',
                // `large` (800px): a card is 15rem or wider, and a press page
                // keeps its own proportions in the masonry wall.
                'thumbnail' => (string) ($item->thumbnailDisplayUrl('large') ?? ''),
                'creators' => array_values(array_filter(array_map(
                    [ItemValue::class, 'text'],
                    (array) $item->value('dcterms:creator', ['all' => true])
                ), static function (string $name): bool {
                    return $name !== '';
                })),
                'publisher' => ItemValue::text($item->value('dcterms:publisher')),
                'date' => self::dateLabel($date, $locale),
                'sortDate' => $date,
                'events' => $cited[$id],
            ];
        }
        usort($cards, static function (array $a, array $b) use ($order) {
            return (($a['sortDate'] === '') <=> ($b['sortDate'] === ''))
                ?: strcmp($a['sortDate'], $b['sortDate'])
                ?: ($order[$a['id']] <=> $order[$b['id']]);
        });
        return array_map(static function (array $card) {
            unset($card['sortDate']);
            return $card;
        }, $cards);
    }

    /** A bare language subtag ("fr", "dyu"), or '' for anything else. */
    private static function subtag(string $code): string
    {
        return preg_match('/^[a-z]{2,3}$/D', $code) ? $code : '';
    }

    /** An ISO date at its own precision, in the timeline's words; anything else as given. */
    private static function dateLabel(string $value, string $locale): string
    {
        $patterns = ['day' => '/^\d{4}-\d{2}-\d{2}$/D', 'month' => '/^\d{4}-\d{2}$/D', 'year' => '/^\d{4}$/D'];
        foreach ($patterns as $precision => $pattern) {
            if (preg_match($pattern, $value)) {
                return Catalog::dateLabel(['value' => $value, 'precision' => $precision], $locale) ?: $value;
            }
        }
        return $value;
    }
}
