<?php
declare(strict_types=1);

// Exercise real nested Laminas partials: include/return stubs miss the output
// buffering contract that stranded all blocks in v1.66.0–v1.68.2.
require rtrim((string) getenv('OMEKA_PATH'), '/\\') . '/vendor/autoload.php';
// The module's own classes, the way Omeka's module autoloader maps them
// (templates reach for some, e.g. OnThisDay::DEFAULT_LAYOUT).
spl_autoload_register(static function (string $class): void {
    $prefix = 'IwacVisualizations\\';
    if (strncmp($class, $prefix, strlen($prefix)) === 0) {
        $file = dirname(__DIR__, 2) . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});

use IwacVisualizations\Site\AssetPlan;
use IwacVisualizations\Site\BlockRegistry;

$view = new \Laminas\View\Renderer\PhpRenderer();
$view->setResolver(new \Laminas\View\Resolver\TemplatePathStack([
    'script_paths' => [dirname(__DIR__, 2) . '/view'],
]));
$helpers = $view->getHelperPluginManager();
$helpers->setService('assetUrl', new class extends \Laminas\View\Helper\AbstractHelper {
    public function __invoke($path, $module) { return '/modules/' . $module . '/asset/' . $path; }
});
$helpers->setService('translate', new class extends \Laminas\View\Helper\AbstractHelper {
    public function __invoke($text) { return $text; }
});
$helpers->setService('currentSite', new class extends \Laminas\View\Helper\AbstractHelper {
    public function __invoke() { return new class { public function slug() { return 'test'; } }; }
});
$helpers->get('basePath')->setBasePath('');

/** The lazy-loader payload emitted immediately before the block wrapper. */
function blockManifest(string $html, string $label): array
{
    if (!preg_match('~<script type="application/json" class="iwac-vis-lazy-manifest">(.*?)</script>\s*<div~s', $html, $match)) {
        throw new \RuntimeException($label . ': no manifest immediately before its block');
    }
    return json_decode($match[1], true, 512, JSON_THROW_ON_ERROR);
}

$count = 0;
foreach (array_keys(AssetPlan::manifest()['blocks']) as $bundle) {
    $html = $view->partial('common/iwac-block-shell', [
        'assets' => ['bundle' => $bundle],
        'blockClass' => 'test-block',
    ]);
    $scripts = blockManifest($html, $bundle)['scripts'];
    if (end($scripts) !== '/modules/IwacVisualizations/asset/js/dist/blocks/' . $bundle . '.min.js') {
        throw new \RuntimeException($bundle . ': missing orchestrator');
    }
    $count++;
}

// Every registered page block, rendered the way a page renders it — through
// `BlockRegistry::partialFor()`, so the twenty registry-shell rows go through
// `_generic` with their REAL declarations. The loop above proves the bundle
// plumbing; this proves each row's own `needs` and `blockCss` arrive. A
// `blockCss` one level too high in a row (Periodicals Overview, for several
// releases) rendered fine and loaded no stylesheet; here it fails.
$module = '/modules/IwacVisualizations/asset/';
$rendered = 0;
foreach (BlockRegistry::BLOCKS as $slug => $row) {
    $html = $view->partial(BlockRegistry::partialFor($slug), ['block' => null, 'slug' => $slug]);
    $payload = blockManifest($html, $slug);
    $scripts = $payload['scripts'];
    if (strpos($html, 'data-embed-slug="' . $slug . '"') === false) {
        throw new \RuntimeException($slug . ': no embed slug on its wrapper');
    }
    if (empty($row['shell'])) {
        $rendered++;
        continue;   // its own template: the embed slug and the manifest are what it shares
    }
    $shell = $row['shell'];
    $assets = $shell['assets'];
    $needs = $assets['needs'] ?? [];
    // escapeHtmlAttr writes the space as `&#x20;`; compare the decoded markup.
    $decoded = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    if (strpos($decoded, 'class="iwac-vis-block ' . $shell['blockClass'] . '"') === false) {
        throw new \RuntimeException($slug . ': the wrapper lost its block class ' . $shell['blockClass']);
    }
    $expected = [];
    foreach (AssetPlan::bundles($needs, $assets['bundle']) as $bundle) {
        $expected[] = $module . 'js/dist/' . $bundle . '.min.js';
    }
    $moduleScripts = array_values(array_filter($scripts, static fn($s) => strpos($s, $module) === 0));
    if ($moduleScripts !== $expected) {
        throw new \RuntimeException($slug . ': bundles ' . json_encode($moduleScripts) . ', expected ' . json_encode($expected));
    }
    if (!empty($needs['maplibre']) !== !empty($payload['mjs'])) {
        throw new \RuntimeException($slug . ': the MapLibre import does not follow its `maplibre` need');
    }
    $hasWordcloud = (bool) array_filter($scripts, static fn($s) => strpos($s, 'echarts-wordcloud') !== false);
    if (!empty($needs['wordcloud']) !== $hasWordcloud) {
        throw new \RuntimeException($slug . ': the word-cloud plugin does not follow its `wordcloud` need');
    }
    $links = html_entity_decode((string) $view->plugin('headLink')->toString(), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    foreach ((array) ($assets['blockCss'] ?? []) as $sheet) {
        if (strpos($links, $module . 'css/blocks/' . $sheet . '.min.css') === false) {
            throw new \RuntimeException($slug . ': its stylesheet ' . $sheet . ' was never enqueued');
        }
    }
    if (strpos($html, 'iwac-vis-loading') === false) {
        throw new \RuntimeException($slug . ': no loading state');
    }
    $rendered++;
}

// The collection overview became a registry row: it must still render its
// loader, and never the static preview it once server-rendered.
$overview = $view->partial(BlockRegistry::partialFor('collection-overview'), ['block' => null, 'slug' => 'collection-overview']);
if (strpos($overview, 'iwac-vis-lazy-manifest') === false
    || strpos($overview, 'iwac-vis-loading') === false
    || strpos($overview, 'data-overview-fallback') !== false
    || strpos($overview, '<svg') !== false) {
    throw new \RuntimeException('Overview must render its loader without the static preview');
}

// An unknown `needs` flag is refused where it would otherwise vanish.
try {
    $view->partial('common/iwac-block-shell', ['assets' => ['needs' => ['renderers' => true]]]);
    throw new \LogicException('an unknown needs flag rendered');
} catch (\RuntimeException $e) {
    // expected: AssetPlan refuses the flag
}

echo "Real Laminas templates: {$count} block manifests, {$rendered} registered blocks and overview passed.\n";
