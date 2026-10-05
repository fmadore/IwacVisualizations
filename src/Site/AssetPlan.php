<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/** Request-wide manifest cache and dependency planning, independent of the view. */
final class AssetPlan
{
    /**
     * Every `needs` flag `view/common/iwac-assets.phtml` understands.
     *
     * The first four pick CDN libraries in the partial itself (`echarts` is
     * the one that defaults ON, so it is only ever passed as `false`); the
     * rest choose shared bundles below. A flag outside this list is a typo or
     * a flag that was removed, and either way the block would silently load
     * without what it asked for — so `bundles()` refuses it.
     *
     * Written as a flat list of single-quoted strings on purpose:
     * `scripts/check-blocks.js` reads it out of this file to check the
     * registry's `needs` against it without a PHP binary.
     */
    public const FLAGS = [
        'echarts',
        'wordcloud',
        'maplibre',
        'd3',
        'chartOptions',
        'facetButtons',
        'table',
        'pagination',
        'timeline',
        'concordance',
        'layout',
    ];

    public static function manifest(): array
    {
        static $manifest;
        if ($manifest === null) {
            $manifest = json_decode((string) file_get_contents(__DIR__ . '/../../asset/js/bundles.json'), true, 512, JSON_THROW_ON_ERROR);
        }
        return $manifest;
    }

    /**
     * Bundles built once per locale, and the locales: `dist/locales.json`,
     * written by scripts/build-js.js beside the bundles it describes. Such a
     * bundle has no locale-neutral file — only `<name>.<locale>.min.js`.
     *
     * @return array{locales: string[], bundles: string[]}
     */
    public static function localized(): array
    {
        static $localized;
        if ($localized === null) {
            $path = __DIR__ . '/../../asset/js/dist/locales.json';
            $data = is_file($path)
                ? json_decode((string) file_get_contents($path), true, 16, JSON_THROW_ON_ERROR)
                : [];
            $localized = [
                'locales' => array_values($data['locales'] ?? []),
                'bundles' => array_values($data['bundles'] ?? []),
            ];
        }
        return $localized;
    }

    /**
     * The file (or, per locale, files) a planned bundle is served from,
     * relative to `asset/`: a string, or `[locale => path]` for a bundle
     * built per locale. The loader picks the page's locale from the map.
     *
     * @return string|array<string, string>
     */
    public static function bundlePath(string $name)
    {
        $localized = self::localized();
        if (!in_array($name, $localized['bundles'], true)) {
            return 'js/dist/' . $name . '.min.js';
        }
        $paths = [];
        foreach ($localized['locales'] as $locale) {
            $paths[$locale] = 'js/dist/' . $name . '.' . $locale . '.min.js';
        }
        return $paths;
    }

    public static function bundles(array $needs, ?string $bundle): array
    {
        foreach (array_keys($needs) as $flag) {
            if (!in_array($flag, self::FLAGS, true)) {
                throw new \RuntimeException('Unknown visualization asset need: ' . $flag);
            }
        }
        $manifest = self::manifest();
        if ($bundle !== null && !isset($manifest['blocks'][$bundle])) {
            throw new \RuntimeException('Unknown visualization bundle: ' . $bundle);
        }
        $names = ['shared-core'];
        $groups = [
            'shared-charts' => ['chartOptions'],
            'shared-ui' => ['pagination', 'table', 'facetButtons', 'timeline', 'concordance'],
            'shared-layout' => ['layout'],
            'shared-map' => ['maplibre'],
            'shared-d3' => ['d3'],
        ];
        foreach ($groups as $name => $flags) {
            foreach ($flags as $flag) {
                if (!empty($needs[$flag])) {
                    $names[] = $name;
                    break;
                }
            }
        }
        if ($bundle !== null) {
            foreach ($manifest['blocks'][$bundle]['uses'] ?? [] as $set) {
                if (!isset($manifest['panels'][$set])) {
                    throw new \RuntimeException('Unknown visualization panel set: ' . $set);
                }
                $names[] = 'panels/' . $set;
            }
            $names[] = 'blocks/' . $bundle;
        }
        return $names;
    }
}
