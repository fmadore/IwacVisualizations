<?php
/**
 * The `<script>` tags a fixture renderer prints in place of the asset
 * loader: the bundles `Site\AssetPlan` plans for the block, in its order,
 * each in the page's locale where it is built per locale. Read from the plan
 * rather than typed per renderer, so a fixture loads what the site loads —
 * when the Svelte runtime moved into `shared-svelte`, a hand-typed list
 * would have kept loading a block bundle that no longer runs alone.
 */
require_once __DIR__ . '/../../src/Site/AssetPlan.php';

use IwacVisualizations\Site\AssetPlan;

function fixtureScripts(string $bundle, string $locale, array $needs = ['echarts' => false]): string
{
    $out = '';
    foreach (AssetPlan::bundles($needs, $bundle) as $name) {
        $path = AssetPlan::bundlePath($name);
        if (is_array($path)) {
            $path = $path[$locale];
        }
        $out .= '<script src="/asset/' . $path . '"></script>' . "\n";
    }
    return $out;
}
