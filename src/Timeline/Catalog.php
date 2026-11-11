<?php
declare(strict_types=1);

namespace IwacVisualizations\Timeline;

/** Reads only the active, verified data generation. No network at page render. */
class Catalog
{
    private $directory;
    private $purify;
    private $cacheDirectory;
    private $cache = [];
    /** @var array<string, string> file name => SHA-256 of the bytes read */
    private $hashes = [];

    /**
     * @param string|null $cacheDirectory where a purified timeline is kept,
     *     so a page view reads it instead of purifying every event again
     *     (HTML Purifier costs ~10–40 ms a timeline; the read, well under
     *     one). Null keeps no cache. The caller scopes it to the generation
     *     and the purifier's version and configuration; each entry is named
     *     after the SHA-256 of the source file too, so a replaced source is a
     *     miss, never a stale answer. A miss — or any failure to read or
     *     write the cache — purifies, exactly as without one.
     */
    public function __construct(string $directory, callable $purify, ?string $cacheDirectory = null)
    {
        $this->directory = rtrim($directory, '/\\') . '/timelines';
        $this->purify = $purify;
        $this->cacheDirectory = $cacheDirectory === null ? null : rtrim($cacheDirectory, '/\\');
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
        $bytes = (string) file_get_contents($path);
        $this->hashes[$name] = hash('sha256', $bytes);
        $value = json_decode($bytes, true);
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
        $name = $slug . '.' . $locale . '.json';
        $value = $this->read($name);
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
        $entry = $slug . '.' . $locale . '.' . ($this->hashes[$name] ?? '') . '.json';
        $clean = $this->readClean($entry, $value);
        if ($clean === null) {
            $clean = [
                'title' => $this->cleanEvent($value['title']),
                'events' => array_map([$this, 'cleanEvent'], $value['events']),
            ];
            $this->writeClean($entry, $clean);
        }
        $value['title'] = $clean['title'];
        $value['events'] = $clean['events'];
        return $value;
    }

    /**
     * The purified title and events cached for this source, or null. Only an
     * entry that matches the validated source event for event (the same ids
     * in the same order) is used; anything else is a miss.
     */
    private function readClean(string $entry, array $value): ?array
    {
        if ($this->cacheDirectory === null) {
            return null;
        }
        $path = $this->cacheDirectory . '/' . $entry;
        $bytes = is_file($path) ? @file_get_contents($path) : false;
        $clean = is_string($bytes) ? json_decode($bytes, true) : null;
        if (!is_array($clean) || !is_array($clean['title'] ?? null) || !is_array($clean['events'] ?? null)
            || ($clean['title']['id'] ?? null) !== $value['title']['id']
            || array_column($clean['events'], 'id') !== array_column($value['events'], 'id')
            || count($clean['events']) !== count($value['events'])
        ) {
            return null;
        }
        return $clean;
    }

    /** Keep a purified timeline, atomically; a failure only costs the next view a purification. */
    private function writeClean(string $entry, array $clean): void
    {
        if ($this->cacheDirectory === null) {
            return;
        }
        $directory = $this->cacheDirectory;
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            return;
        }
        $json = json_encode($clean, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($json)) {
            return;
        }
        $temp = $directory . '/.' . $entry . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($temp, $json) !== strlen($json) || !@rename($temp, $directory . '/' . $entry)) {
            @unlink($temp);
        }
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

    /**
     * An image's small square: Omeka's 200px square derivative where the image
     * is an IWAC item file (the axis cards and the introduction's collage
     * share it, so it downloads once), else the sheet's thumbnail or the image.
     * '' for media that is not an image.
     */
    public static function thumbnail(?array $media): string
    {
        if (!$media || ($media['type'] ?? '') !== 'image') {
            return '';
        }
        $url = (string) $media['url'];
        return preg_match('#^https://islam\.zmo\.de/files/(?:large|medium)/#', $url)
            ? (string) preg_replace('#/files/(?:large|medium)/#', '/files/square/', $url, 1)
            : ((string) ($media['thumbnail'] ?? '') ?: $url);
    }

    /**
     * The lead clipping's image: Omeka's large derivative where the image is
     * an IWAC item file — the lead tile spans two columns and two rows, where
     * the 200px square would be upscaled past legibility — else the image.
     */
    public static function leadImage(?array $media): string
    {
        if (!$media || ($media['type'] ?? '') !== 'image') {
            return '';
        }
        $url = (string) $media['url'];
        return preg_match('#^https://islam\.zmo\.de/files/(?:large|medium|square)/#', $url)
            ? (string) preg_replace('#/files/(?:medium|square)/#', '/files/large/', $url, 1)
            : $url;
    }

    /**
     * The events whose images make the introduction's collage: at most nine,
     * spread evenly over the chronology (the first and the last always in), in
     * the order given. The count is one the front-page mosaic tiles without a
     * hole: 9 (a lead, two beside it, a row of six under the lede), 6 (two rows
     * of three beside the lede), 3 (a lead and two), or all of two or fewer.
     * An empty list when no event has an image: the introduction then has no
     * collage and reserves no room for it.
     *
     * @param array[] $events dated events, chronological
     * @return array[]
     */
    public static function collage(array $events): array
    {
        $images = array_values(array_filter($events, static function ($event) {
            return self::thumbnail($event['media'] ?? null) !== '';
        }));
        $available = count($images);
        $count = $available >= 9 ? 9 : ($available >= 6 ? 6 : ($available >= 3 ? 3 : $available));
        if ($count <= 1) {
            return $images;
        }
        $picked = [];
        for ($i = 0; $i < $count; $i++) {
            $picked[] = $images[(int) round($i * ($available - 1) / ($count - 1))];
        }
        return $picked;
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
