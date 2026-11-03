<?php
declare(strict_types=1);

// Exercise real nested Laminas partials: include/return stubs miss the output
// buffering contract that stranded all blocks in v1.66.0–v1.68.2.
// A warning or a deprecation the module raises fails the run, not just prints.
require dirname(__DIR__) . '/lib/strict-errors.php';
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
    // A bundle carrying translation dictionaries is built once per locale and
    // listed as {locale: url}; the loader picks the page's language.
    $base = '/modules/IwacVisualizations/asset/js/dist/blocks/' . $bundle;
    $last = end($scripts);
    $expected = is_array($last)
        ? array_combine(array_keys($last), array_map(fn ($locale) => $base . '.' . $locale . '.min.js', array_keys($last)))
        : $base . '.min.js';
    if ($last !== $expected || (is_array($last) && array_keys($last) !== ['en', 'fr'])) {
        throw new \RuntimeException($bundle . ': missing orchestrator');
    }
    foreach ($scripts as $script) {
        foreach ((array) $script as $url) {
            $file = dirname(__DIR__, 2) . '/asset/' . substr($url, strlen('/modules/IwacVisualizations/asset/'));
            if (strpos($url, '/modules/') === 0 && !is_file($file)) {
                throw new \RuntimeException($bundle . ': manifest names ' . $url . ', which the build did not write');
            }
        }
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
    if (empty($row['shell'])) {
        // Its own template: an embeddable one must still carry its embed
        // slug. With no `$block` the timeline has no timeline to render and
        // prints only its "unavailable" note — no wrapper to carry one; its
        // embed is checked below, with data.
        $unavailable = strpos($html, 'iwac-vis-timeline-unavailable') !== false;
        if (!empty($row['embeddable']) && !$unavailable && strpos($html, 'data-embed-slug="' . $slug . '"') === false) {
            throw new \RuntimeException($slug . ': no embed slug on its wrapper');
        }
        $rendered++;
        continue;
    }
    if (strpos($html, 'data-embed-slug="' . $slug . '"') === false) {
        throw new \RuntimeException($slug . ': no embed slug on its wrapper');
    }
    $payload = blockManifest($html, $slug);
    $scripts = $payload['scripts'];
    $shell = $row['shell'];
    $assets = $shell['assets'];
    $needs = $assets['needs'] ?? [];
    // escapeHtmlAttr writes the space as `&#x20;`; compare the decoded markup.
    $decoded = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    if (strpos($decoded, 'class="iwac-vis-block ' . $shell['blockClass'] . '"') === false) {
        throw new \RuntimeException($slug . ': the wrapper lost its block class ' . $shell['blockClass']);
    }
    // A localized bundle is a {locale: url} entry; compare it whole.
    $expected = [];
    foreach (AssetPlan::bundles($needs, $assets['bundle']) as $bundle) {
        $path = AssetPlan::bundlePath($bundle);
        $expected[] = is_array($path)
            ? array_map(static fn($p) => $module . $p, $path)
            : $module . $path;
    }
    $moduleScripts = array_values(array_filter(
        $scripts,
        static fn($s) => strpos(is_array($s) ? (string) reset($s) : $s, $module) === 0
    ));
    if ($moduleScripts !== $expected) {
        throw new \RuntimeException($slug . ': bundles ' . json_encode($moduleScripts) . ', expected ' . json_encode($expected));
    }
    if (!empty($needs['maplibre']) !== !empty($payload['mjs'])) {
        throw new \RuntimeException($slug . ': the MapLibre import does not follow its `maplibre` need');
    }
    // The clouds are laid out by C.wordcloud since v1.88.0; the plugin is gone.
    if (array_filter($scripts, static fn($s) => is_string($s) && strpos($s, 'echarts-wordcloud') !== false)) {
        throw new \RuntimeException($slug . ': loads the retired echarts-wordcloud plugin');
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

// --- Embeds -----------------------------------------------------------------

// The embed routes, matched by the real router from the module's own config.
// `/item/12` must reach the dashboard route although `/:block/:panel` would
// also match it — which is what that route's priority is for.
$config = require dirname(__DIR__, 2) . '/config/module.config.php';
$router = \Laminas\Router\Http\TreeRouteStack::factory([
    'route_plugins' => new \Laminas\Router\RoutePluginManager(new \Laminas\ServiceManager\ServiceManager()),
    'routes' => ['iwac-embed' => $config['router']['routes']['site']['child_routes']['iwac-embed']],
]);
$route = static function (string $path) use ($router): ?array {
    $request = new \Laminas\Http\Request();
    $request->setUri('https://example.org' . $path);
    $match = $router->match($request);
    return $match ? ['route' => $match->getMatchedRouteName()] + $match->getParams() : null;
};
foreach ([
    '/iwac-embed'                      => ['iwac-embed', 'index', []],
    '/iwac-embed/laicite'              => ['iwac-embed/block', 'block', ['block' => 'laicite']],
    '/iwac-embed/laicite/panel-1'      => ['iwac-embed/block/panel', 'block', ['block' => 'laicite', 'panel' => 'panel-1']],
    '/iwac-embed/item/12'              => ['iwac-embed/resource', 'resource', ['resource' => 'item', 'id' => '12']],
    '/iwac-embed/item/12/panel-2'      => ['iwac-embed/resource', 'resource', ['resource' => 'item', 'id' => '12', 'panel' => 'panel-2']],
    '/iwac-embed/item-set/3'           => ['iwac-embed/resource', 'resource', ['resource' => 'item-set', 'id' => '3']],
    // Not a number: an (unknown) block and its panel, never a dashboard.
    '/iwac-embed/item/abc'             => ['iwac-embed/block/panel', 'block', ['block' => 'item', 'panel' => 'abc']],
] as $path => [$name, $action, $params]) {
    $got = $route($path);
    if ($got === null || $got['route'] !== $name || $got['action'] !== $action) {
        throw new \RuntimeException("$path routed to " . json_encode($got) . ", expected $name → $action");
    }
    foreach ($params as $key => $value) {
        if ((string) ($got[$key] ?? '') !== $value) {
            throw new \RuntimeException("$path: $key is " . json_encode($got[$key] ?? null) . ", expected $value");
        }
    }
}

// A configured block in an embed: the URL's choice becomes its variables, a
// choice that names nothing is null (the controller's 404), and the wrapper
// says how to embed it again — the choice, and one button for the whole.
$pipeline = \IwacVisualizations\Site\BlockLayout\PipelineExplainer::class;
if (array_keys($pipeline::embedVariants($helpers)) !== \IwacVisualizations\Site\PipelinePresets::ids()) {
    throw new \RuntimeException('The pipeline embed does not list every preset');
}
if ($pipeline::embedVariables($helpers, 'no-such-preset') !== null || $pipeline::embedVariables($helpers, '') !== null) {
    throw new \RuntimeException('A pipeline embed naming no preset rendered a default one');
}
$embedded = html_entity_decode($view->render(
    (new \Laminas\View\Model\ViewModel([
        'slug' => 'pipeline-explainer',
        'variables' => $pipeline::embedVariables($helpers, 'ask-ai'),
    ]))->setTemplate('iwac-visualizations/embed/block')
), ENT_QUOTES | ENT_HTML5, 'UTF-8');
foreach (['data-preset="ask-ai"', 'data-embed-slug="pipeline-explainer"', 'data-embed-query="preset=ask-ai"', 'data-embed-whole=""'] as $needle) {
    if (strpos($embedded, $needle) === false) {
        throw new \RuntimeException('The pipeline embed lost ' . $needle);
    }
}

// A dashboard in an embed: the item's title heads it, and its panels can be
// pinned through the dashboard route. On the page it keeps "Visualisations".
$resource = new class {
    public function id() { return 4321; }
    public function displayTitle() { return 'Amadou Hampâté Bâ'; }
};
$dashboard = html_entity_decode($view->render(
    (new \Laminas\View\Model\ViewModel([
        'partial' => 'common/resource-page-block-layout/visualizations/person',
        'resource' => $resource,
    ]))->setTemplate('iwac-visualizations/embed/resource')
), ENT_QUOTES | ENT_HTML5, 'UTF-8');
if (strpos($dashboard, '<h2>Amadou Hampâté Bâ</h2>') === false || strpos($dashboard, 'data-embed-slug="item/4321"') === false) {
    throw new \RuntimeException('The person dashboard embed lost its title or its embed slug');
}
$onPage = $view->partial('common/resource-page-block-layout/item-set-dashboard', ['resource' => $resource]);
if (strpos($onPage, '<h2>Visualisations</h2>') === false || strpos($onPage, 'data-embed-slug="item-set&#x2F;4321"') === false) {
    throw new \RuntimeException('The item-set dashboard lost its heading or its embed slug on the page');
}

echo "Real Laminas templates: {$count} block manifests, {$rendered} registered blocks and overview passed.\n";
echo "Embeds: routes, configured-block variables and dashboard frames passed.\n";
