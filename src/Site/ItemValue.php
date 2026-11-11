<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/**
 * Reading Omeka values for display, shared by the templates and the timeline.
 *
 * Pure static methods over duck-typed value objects, so tests/php/run.php can
 * drive them with small fakes instead of Omeka's representations.
 */
final class ItemValue
{
    /** The hosts a watch link may point at: this becomes an outbound link. */
    public const WATCH_HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'];

    /**
     * The display text of a value that may be a literal, a URI, or a link to
     * another resource: the linked resource's title, else the literal, else
     * the URI. `(string) $value` only covers the literal case — a linked
     * authority record stringifies to "" — and dcterms:publisher on a YouTube
     * video is exactly that case (channels are foaf:Organization items).
     *
     * @param \Omeka\Api\Representation\ValueRepresentation|mixed $value
     */
    public static function text($value): string
    {
        if (!is_object($value)) {
            return '';
        }
        $linked = $value->valueResource();
        if ($linked) {
            return trim((string) $linked->displayTitle());
        }
        $literal = trim((string) $value->value());
        return $literal !== '' ? $literal : trim((string) $value->uri());
    }

    /**
     * `$url` unchanged when it is an https link to YouTube, else ''.
     *
     * The host must be one of WATCH_HOSTS exactly (so `youtube.com.evil.example`
     * is not), with no credentials, no port, and no whitespace, control
     * character or backslash anywhere — PHP and browsers parse those
     * differently, so a URL PHP reads as YouTube could open somewhere else.
     */
    public static function watchUrl(string $url): string
    {
        if ($url === '' || preg_match('/[\s\x00-\x1f\x7f\\\\]/', $url)) {
            return '';
        }
        $parts = parse_url($url);
        if (!is_array($parts)
            || strtolower($parts['scheme'] ?? '') !== 'https'
            || !in_array(strtolower($parts['host'] ?? ''), self::WATCH_HOSTS, true)
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])
        ) {
            return '';
        }
        return $url;
    }
}
