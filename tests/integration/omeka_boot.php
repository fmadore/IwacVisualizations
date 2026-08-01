<?php
declare(strict_types=1);

use IwacVisualizations\Site\BlockRegistry;
use Laminas\Http\PhpEnvironment\Request;
use Laminas\Http\Response;
use Laminas\Mvc\MvcEvent;
use Laminas\Router\Http\RouteMatch;
use Omeka\Module\Manager as OmekaModuleManager;

$omekaPath = rtrim((string) getenv('OMEKA_PATH'), '/\\');
if ($omekaPath === '' || !is_file($omekaPath . '/bootstrap.php')) {
    fwrite(STDERR, "OMEKA_PATH must point to an extracted Omeka S distribution.\n");
    exit(2);
}

$expectedOmekaVersion = trim((string) getenv('EXPECTED_OMEKA_VERSION'));
$expectedPhpSeries = trim((string) getenv('EXPECTED_PHP_SERIES'));
if ($expectedOmekaVersion === '' || !preg_match('/^\d+\.\d+\.\d+$/', $expectedOmekaVersion)) {
    fwrite(STDERR, "EXPECTED_OMEKA_VERSION must be an exact semantic version.\n");
    exit(2);
}
if ($expectedPhpSeries === '' || !preg_match('/^\d+\.\d+$/', $expectedPhpSeries)) {
    fwrite(STDERR, "EXPECTED_PHP_SERIES must be a major.minor version.\n");
    exit(2);
}

require $omekaPath . '/bootstrap.php';
$config = require $omekaPath . '/application/config/application.config.php';
$application = \Omeka\Mvc\Application::init($config);
$services = $application->getServiceManager();

$failures = [];
$checks = 0;
function checkIntegration(bool $condition, string $message): void
{
    global $failures, $checks;
    $checks++;
    if (!$condition) {
        $failures[] = $message;
    }
}

$actualPhpSeries = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
checkIntegration(
    $actualPhpSeries === $expectedPhpSeries,
    "CI booted PHP {$actualPhpSeries}; expected {$expectedPhpSeries}"
);
checkIntegration(
    \Omeka\Module::VERSION === $expectedOmekaVersion,
    sprintf(
        'CI booted Omeka S %s; expected %s',
        \Omeka\Module::VERSION,
        $expectedOmekaVersion
    )
);

$moduleManager = $services->get('Omeka\\ModuleManager');
$registered = $moduleManager->getModule('IwacVisualizations');
checkIntegration(
    $registered->getState() === OmekaModuleManager::STATE_ACTIVE,
    'IwacVisualizations was not loaded as an installed active module'
);
checkIntegration(
    $registered->getIni('version') === $registered->getDb('version'),
    'module.ini and installed database versions disagree'
);
checkIntegration(
    $services->get('ModuleManager')->getModule('IwacVisualizations') instanceof \IwacVisualizations\Module,
    'Laminas did not instantiate the module class'
);

$blockLayouts = $services->get('Omeka\\BlockLayoutManager');
foreach (BlockRegistry::BLOCKS as $slug => $definition) {
    $name = $definition['invokable'];
    $expectedClass = $definition['class'];
    checkIntegration($blockLayouts->has($name), "page-block service missing: {$name}");
    if ($blockLayouts->has($name)) {
        checkIntegration(
            $blockLayouts->get($name) instanceof $expectedClass,
            "page-block service resolves the wrong class: {$name}"
        );
    }
}

$resourceLayouts = $services->get('Omeka\\ResourcePageBlockLayoutManager');
checkIntegration($resourceLayouts->has('visualizations'), 'resource visualizations service missing');
checkIntegration($resourceLayouts->has('itemSetDashboard'), 'item-set dashboard service missing');

$controllers = $services->get('ControllerManager');
checkIntegration(
    $controllers->has('IwacVisualizations\\Controller\\Site\\Embed'),
    'embed controller service missing'
);
checkIntegration(
    $controllers->has('IwacVisualizations\\Controller\\Admin\\Data'),
    'admin data controller service missing'
);

$router = $services->get('Router');
$routeCases = [
    '/s/test/iwac-embed/collection-overview/panel-0' => 'site/iwac-embed/block/panel',
    '/admin/iwac-visualizations/sync' => 'admin/iwac-visualizations/sync',
];
foreach ($routeCases as $path => $expectedName) {
    $request = new Request();
    $request->setUri('https://example.test' . $path);
    $match = $router->match($request);
    checkIntegration($match !== null, "route did not match: {$path}");
    if ($match) {
        checkIntegration($match->getMatchedRouteName() === $expectedName, "wrong route name: {$path}");
    }
}

$renderer = $services->get('ViewRenderer');
$resolved = $renderer->resolver()->resolve('common/block-layout/collection-overview', $renderer);
checkIntegration(is_string($resolved) && is_file($resolved), 'module page-block template did not resolve');

// Hydrate the site/page/block rows seeded by CI through Omeka's real API and
// render the registered layout. This reaches beyond service resolution into
// Doctrine mapping, representations, view helpers, nested module partials and
// the final HTML contract on every supported matrix target.
$api = $services->get('Omeka\\ApiManager');
$site = $api->read('sites', 1)->getContent();
$page = $api->read('site_pages', 1)->getContent();
$seededBlocks = $page->blocks();
checkIntegration(count($seededBlocks) === 1, 'seeded page did not hydrate exactly one block');
if (count($seededBlocks) === 1) {
    $seededBlock = $seededBlocks[0];
    checkIntegration(
        $seededBlock->layout() === 'collectionOverview',
        'seeded page block hydrated with the wrong layout'
    );
    $services->get('ViewHelperManager')->get('currentSite')->setSite($site);
    $renderedBlock = $blockLayouts->get('collectionOverview')->render($renderer, $seededBlock);
    $decodedBlock = html_entity_decode($renderedBlock, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    checkIntegration(
        strpos($decodedBlock, 'class="iwac-vis-block iwac-vis-overview"') !== false,
        'seeded collection overview did not render its module wrapper: '
            . substr(preg_replace('/\s+/', ' ', $renderedBlock), 0, 240)
    );
    checkIntegration(
        strpos($renderedBlock, 'data-embed-slug="collection-overview"') !== false,
        'seeded collection overview did not render its embed contract'
    );
}

// Exercise the real Laminas response headers around the embed framing policy.
$response = new Response();
$response->getHeaders()->addHeaderLine('X-Frame-Options', 'SAMEORIGIN');
$response->getHeaders()->addHeaderLine('X-Frame-Options', 'DENY');
$response->getHeaders()->addHeaderLine(
    'Content-Security-Policy',
    "default-src 'self'; frame-ancestors 'self'; img-src data:"
);
$response->getHeaders()->addHeaderLine(
    'Content-Security-Policy',
    "script-src 'self'"
);
$routeMatch = new RouteMatch([]);
$routeMatch->setMatchedRouteName('site/iwac-embed/block');
$event = new MvcEvent();
$event->setRouteMatch($routeMatch);
$event->setResponse($response);
(new \IwacVisualizations\Module())->relaxEmbedFraming($event);
checkIntegration(!$response->getHeaders()->has('X-Frame-Options'), 'embed response retained X-Frame-Options');
$cspValues = [];
foreach ($response->getHeaders() as $header) {
    if (strcasecmp($header->getFieldName(), 'Content-Security-Policy') === 0) {
        // Older Laminas HTTP releases append a final semicolon while parsing a
        // generic CSP header. Normalize that syntactic difference only.
        $cspValues[] = rtrim(trim($header->getFieldValue()), ';');
    }
}
checkIntegration(
    $cspValues === [
        "default-src 'self'; frame-ancestors *; img-src data:",
        "script-src 'self'; frame-ancestors *",
    ],
    'embed response did not preserve and relax its existing CSP: '
        . json_encode($cspValues)
);

if ($failures) {
    fwrite(STDERR, "\nOmeka integration tests failed:\n");
    foreach ($failures as $failure) {
        fwrite(STDERR, '  - ' . $failure . "\n");
    }
    exit(1);
}

echo sprintf(
    "Omeka integration passed: %d checks on Omeka %s / PHP %s\n",
    $checks,
    \Omeka\Module::VERSION,
    PHP_VERSION
);
