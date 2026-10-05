<?php
declare(strict_types=1);

namespace IwacVisualizations\Timeline;

/** Reads only the active, verified data generation. No network at page render. */
class Catalog
{
    private $directory;
    private $purify;
    private $cache = [];

    public function __construct(string $directory, callable $purify)
    {
        $this->directory = rtrim($directory, '/\\') . '/timelines';
        $this->purify = $purify;
    }

    public static function validId(string $value): bool
    {
        return (bool) preg_match('/^[a-z0-9][a-z0-9-]{0,79}$/D', $value);
    }

    private function read(string $name): ?array
    {
        if (array_key_exists($name, $this->cache)) {
            return $this->cache[$name];
        }
        $path = $this->directory . '/' . $name;
        if (!is_readable($path) || filesize($path) > 8 * 1024 * 1024) {
            return $this->cache[$name] = null;
        }
        $value = json_decode((string) file_get_contents($path), true);
        return $this->cache[$name] = is_array($value) && ($value['schemaVersion'] ?? null) === 1 ? $value : null;
    }

    public function entries(): array
    {
        $index = $this->read('index.json');
        $out = [];
        foreach (is_array($index['timelines'] ?? null) ? $index['timelines'] : [] as $entry) {
            if (is_array($entry) && self::validId((string) ($entry['slug'] ?? ''))
                && is_array($entry['locales'] ?? null)
            ) {
                $out[$entry['slug']] = $entry;
            }
        }
        return $out;
    }

    public function load(string $slug, string $locale): ?array
    {
        $entries = $this->entries();
        if (!self::validId($slug) || !in_array($locale, ['en', 'fr'], true)
            || empty($entries[$slug]['locales'][$locale])
        ) {
            return null;
        }
        // Never turn a filename supplied by JSON or block settings into a path.
        $value = $this->read($slug . '.' . $locale . '.json');
        if (!$value || ($value['slug'] ?? '') !== $slug || ($value['locale'] ?? '') !== $locale
            || !is_array($value['title'] ?? null) || empty($value['title']['headline'])
            || !is_array($value['events'] ?? null) || !$value['events']
        ) {
            return null;
        }
        $ids = [];
        foreach (array_merge([$value['title']], $value['events']) as $event) {
            if (!is_array($event) || !self::validId((string) ($event['id'] ?? ''))
                || isset($ids[$event['id']]) || !is_string($event['textHtml'] ?? null)
                || !is_string($event['headline'] ?? null)
                || !is_string($event['displayDate'] ?? null) || !is_int($event['sourceOrder'] ?? null)
            ) {
                return null;
            }
            $ids[$event['id']] = true;
            foreach (['start', 'end'] as $key) {
                if (($event[$key] ?? null) !== null && !self::validDate($event[$key])) {
                    return null;
                }
            }
            if ($event['id'] !== 'intro' && empty($event['start'])) {
                return null;
            }
            if ($event['id'] === 'intro' && (!empty($event['start']) || !empty($event['end']))) {
                return null;
            }
            if (!empty($event['end']) && strcmp(str_pad($event['end']['value'], 10, '-99'), str_pad($event['start']['value'], 10, '-01')) < 0) {
                return null;
            }
        }
        if (($value['title']['id'] ?? '') !== 'intro') {
            return null;
        }
        $value['title'] = $this->cleanEvent($value['title']);
        $value['events'] = array_map([$this, 'cleanEvent'], $value['events']);
        return $value;
    }

    public static function validDate($value): bool
    {
        if (!is_array($value) || !is_string($value['precision'] ?? null)) {
            return false;
        }
        $patterns = ['year' => '/^\d{4}$/D', 'month' => '/^\d{4}-\d{2}$/D', 'day' => '/^\d{4}-\d{2}-\d{2}$/D'];
        $pattern = $patterns[$value['precision'] ?? ''] ?? null;
        if (!$pattern || !is_string($value['value'] ?? null) || !preg_match($pattern, $value['value'])) {
            return false;
        }
        $parts = explode('-', $value['value']);
        return checkdate((int) ($parts[1] ?? 1), (int) ($parts[2] ?? 1), (int) $parts[0]);
    }

    public static function safeUrl(string $value): string
    {
        $parts = parse_url($value);
        return is_array($parts) && in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
            && !empty($parts['host']) && !isset($parts['user']) && !isset($parts['pass'])
            && !preg_match('/[\x00-\x20\\\\]/', $value) ? $value : '';
    }

    private function cleanEvent(array $event): array
    {
        // Defence at the HTML boundary, including manually installed archives.
        $event['textHtml'] = ($this->purify)($event['textHtml']);
        $media = $event['media'] ?? null;
        if (is_array($media) && self::safeUrl((string) ($media['url'] ?? '')) !== '') {
            $media['url'] = self::safeUrl($media['url']);
            $media['thumbnail'] = self::safeUrl((string) ($media['thumbnail'] ?? ''));
            $media['alt'] = is_string($media['alt'] ?? null) ? $media['alt'] : '';
            if (!in_array($media['type'] ?? '', ['image', 'map', 'link'], true)) {
                $media['type'] = 'link';
            }
            foreach (['captionHtml', 'creditHtml'] as $key) {
                $media[$key] = ($this->purify)((string) ($media[$key] ?? ''));
            }
            $event['media'] = $media;
        } else {
            $event['media'] = null;
        }
        return $event;
    }

    public static function dateLabel(?array $value, string $locale): string
    {
        if (!$value || !self::validDate($value)) {
            return '';
        }
        $parts = explode('-', $value['value']);
        if (count($parts) === 1) {
            return $parts[0];
        }
        // No timezone conversion and no dependency on the server's ICU locale.
        $months = $locale === 'fr'
            ? ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
            : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        $month = $months[(int) $parts[1] - 1];
        if (count($parts) === 2) {
            return $month . ' ' . $parts[0];
        }
        return $locale === 'fr'
            ? (int) $parts[2] . ' ' . $month . ' ' . $parts[0]
            : $month . ' ' . (int) $parts[2] . ', ' . $parts[0];
    }

    public static function eventDate(array $event, string $locale): string
    {
        if (!empty($event['displayDate'])) {
            return $event['displayDate'];
        }
        $start = self::dateLabel($event['start'] ?? null, $locale);
        return $start . (!empty($event['end']) ? ' – ' . self::dateLabel($event['end'], $locale) : '');
    }
}
