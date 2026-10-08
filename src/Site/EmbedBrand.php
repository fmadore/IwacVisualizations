<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/**
 * The brand accents an embed page overrides, and the webfonts it loads.
 *
 * The embed route renders without the IWAC theme's stylesheet, so its tokens
 * come from `asset/css/iwac-embed-tokens.css`, generated from the theme's
 * `tokens.json`: the theme's OWN derivation of its brand seeds (light
 * `--primary` is the seed mixed 8 % toward black in oklab, `#ce4115` for the
 * stock `#e64a19`). The layout used to hand the raw `primary_color` setting
 * straight to `--primary`, so every live embed painted `#e64a19` — 3.82:1 on
 * the surface, and a second primary beside the canonical one its series,
 * type and focus tokens still carried.
 *
 * So a setting (or `?primary=`) that equals the theme's seed overrides
 * nothing, and any other value is treated as a SEED too: `iwac-embed.css`
 * derives `--primary` and its family from it with the theme's own mixes.
 */
final class EmbedBrand
{
    /**
     * The webfont request IWAC-theme's `view/layout/layout.phtml` makes —
     * Besley 500/600/800, Public Sans, Source Serif 4 — on Bunny Fonts, the
     * theme's GDPR-safe Google Fonts mirror. Without it an embed set every
     * heading and chart label in the fallback stack. `tests/js/embed-brand.test.js`
     * checks the families and weights against `tokens.json`'s `fonts`.
     */
    public const WEBFONT_URL = 'https://fonts.bunny.net/css?family=besley:500,600,800|public-sans:ital,wght@0,400..700;1,400|source-serif-4:ital,opsz,wght@0,8..60,400..600;1,8..60,400&display=swap';

    public const WEBFONT_ORIGIN = 'https://fonts.bunny.net';

    /**
     * The theme's seeds, from the file `npm run build:embed-tokens` writes.
     *
     * @return array{primary?: string, secondary?: string}
     */
    public static function seeds(): array
    {
        $file = dirname(__DIR__, 2) . '/config/theme-seeds.php';
        $seeds = is_file($file) ? include $file : [];
        return is_array($seeds) ? $seeds : [];
    }

    /**
     * A strictly validated `#` + 3/6/8-digit hex, lower-cased and with the
     * short form expanded, or '' for anything else.
     */
    public static function normalize(string $value): string
    {
        $hex = strtolower(ltrim(trim($value), '#'));
        if (!preg_match('/^[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/', $hex)) {
            return '';
        }
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return '#' . $hex;
    }

    /**
     * The seeds this embed must override: `?primary=` wins over the theme
     * setting, and a value equal to the theme's own seed is dropped.
     *
     * @param array{primary?: string, secondary?: string}|null $seeds
     * @return array{primary: string, secondary: string}
     */
    public static function accents(string $requested, string $themePrimary, string $themeSecondary, ?array $seeds = null): array
    {
        $seeds = $seeds ?? self::seeds();
        $primary = self::normalize($requested);
        if ($primary === '') {
            $primary = self::normalize($themePrimary);
        }
        $secondary = self::normalize($themeSecondary);
        if ($primary !== '' && $primary === ($seeds['primary'] ?? null)) {
            $primary = '';
        }
        if ($secondary !== '' && $secondary === ($seeds['secondary'] ?? null)) {
            $secondary = '';
        }
        return ['primary' => $primary, 'secondary' => $secondary];
    }
}
