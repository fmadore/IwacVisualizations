<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/** Request-wide manifest cache and dependency planning, independent of the view. */
final class AssetPlan
{
    public static function manifest(): array
    {
        static $manifest;
        if ($manifest === null) {
            $manifest = json_decode((string) file_get_contents(__DIR__ . '/../../asset/js/bundles.json'), true, 512, JSON_THROW_ON_ERROR);
        }
        return $manifest;
    }

    public static function bundles(array $needs, ?string $bundle): array
    {
        $manifest = self::manifest();
        if ($bundle !== null && !isset($manifest['blocks'][$bundle])) {
            throw new \RuntimeException('Unknown visualization bundle: ' . $bundle);
        }
        $names = ['shared-core'];
        $groups = [
            'shared-charts' => ['chartOptions'],
            'shared-ui' => ['pagination', 'table', 'facetButtons', 'timeline', 'concordance'],
            'shared-layout' => ['layout', 'renderers'],
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
