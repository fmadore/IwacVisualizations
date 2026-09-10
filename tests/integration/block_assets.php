<?php
declare(strict_types=1);

// Exercise real nested Laminas partials: include/return stubs miss the output
// buffering contract that stranded all blocks in v1.66.0–v1.68.2.
require rtrim((string) getenv('OMEKA_PATH'), '/\\') . '/vendor/autoload.php';
require dirname(__DIR__, 2) . '/src/Site/AssetPlan.php';

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

$count = 0;
foreach (array_keys(\IwacVisualizations\Site\AssetPlan::manifest()['blocks']) as $bundle) {
    $html = $view->partial('common/iwac-block-shell', [
        'assets' => ['bundle' => $bundle],
        'blockClass' => 'test-block',
    ]);
    if (!preg_match('~<script type="application/json" class="iwac-vis-lazy-manifest">(.*?)</script>\s*<div~s', $html, $match)) {
        throw new \RuntimeException($bundle . ': no manifest immediately before its block');
    }
    $payload = json_decode($match[1], true, 512, JSON_THROW_ON_ERROR);
    $scripts = $payload['scripts'];
    if (end($scripts) !== '/modules/IwacVisualizations/asset/js/dist/blocks/' . $bundle . '.min.js') {
        throw new \RuntimeException($bundle . ': missing orchestrator');
    }
    $count++;
}
$overview = $view->partial('common/block-layout/collection-overview');
if (strpos($overview, 'iwac-vis-lazy-manifest') === false
    || strpos($overview, 'iwac-vis-loading') === false
    || strpos($overview, 'data-overview-fallback') !== false
    || strpos($overview, '<svg') !== false) {
    throw new \RuntimeException('Overview must render its loader without the static preview');
}
echo "Real Laminas templates: {$count} block manifests and overview passed.\n";
