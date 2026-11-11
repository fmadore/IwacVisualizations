<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/**
 * The site's language, by one rule everywhere it is asked.
 *
 * Callers pass the candidate locales in order of precedence — the site's
 * `locale` setting, then the installation's — and the first non-blank one
 * wins. The embed layout's `<html lang>`, the embed bundle variant, the
 * embed 404 page and the timeline block all resolve it here: they used to
 * disagree, so a site with a blank site locale under a French global one got
 * French UI strings around an English timeline.
 */
final class Locale
{
    /** The languages the module ships UI strings and timelines in. */
    public const LANGUAGES = ['en', 'fr'];

    /**
     * The primary language subtag of the first non-blank locale, lowercased
     * (`fr_FR` → `fr`, `de` → `de`), else `en`. This is what `<html lang>`
     * carries.
     *
     * @param mixed ...$locales setting values, usually strings or null
     */
    public static function code(...$locales): string
    {
        foreach ($locales as $locale) {
            if (!is_string($locale)) {
                continue;
            }
            $subtag = strtolower((string) preg_replace('/[^A-Za-z].*$/s', '', trim($locale)));
            if ($subtag !== '') {
                return $subtag;
            }
        }
        return 'en';
    }

    /**
     * One of LANGUAGES for the same locales: `code()` when the module speaks
     * it, else English.
     *
     * @param mixed ...$locales setting values, usually strings or null
     */
    public static function language(...$locales): string
    {
        $code = self::code(...$locales);
        return in_array($code, self::LANGUAGES, true) ? $code : 'en';
    }

    /** The other of the two LANGUAGES: the fallback when content exists in one only. */
    public static function other(string $language): string
    {
        return $language === 'fr' ? 'en' : 'fr';
    }
}
