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

// ---------------------------------------------------------------------------
// EmbedController::blockAction across its parameter matrix (Tier 8 / B3 (4)).
//
// Every branch in that method reads a request the module does not control:
// a route `:block` that may be anything a URL can carry, an optional
// `:panel`, and two query parameters. Three of those four are validated,
// and until now nothing exercised the validation - the suite proved the
// controller service RESOLVED and that one route MATCHED, which is a
// different claim.
//
// It runs here rather than in tests/php/run.php on purpose: `params()`,
// `layout()` and `getResponse()` are real Laminas plugins reading a real
// MvcEvent, and stubbing them would only test the stubs. The slug list
// comes from BlockRegistry so it cannot drift from the whitelist.
$embedController = $controllers->get('IwacVisualizations\Controller\Site\Embed');

/**
 * Dispatch blockAction the way Omeka does, and report what came back: the
 * status code, the view template, and the layout variables the embed
 * layout renders from.
 *
 * `dispatch()` and not a direct `blockAction()` call, because the request
 * and the response the controller reads are its OWN properties - set only
 * by dispatch - not the ones on the event. Calling the action directly
 * would hand it a blank request, and every ?theme / ?primary assertion
 * below would pass by reading nothing. A fresh Response per call keeps a
 * 404 from one case leaking into the next.
 */
$dispatchEmbed = function (array $routeParams, array $queryParams) use ($embedController) {
    $request = new Request();
    $request->setQuery(new \Laminas\Stdlib\Parameters($queryParams));
    $response = new Response();

    $event = new MvcEvent();
    // `action` is what onDispatch() reads to pick the method.
    $event->setRouteMatch(new RouteMatch($routeParams + ['action' => 'block']));
    // The layout plugin refuses to work without one, which is also how the
    // real dispatch supplies it.
    $event->setViewModel(new \Laminas\View\Model\ViewModel());
    $embedController->setEvent($event);

    $view = $embedController->dispatch($request, $response);
    return [
        'status'   => $response->getStatusCode(),
        'template' => $view->getTemplate(),
        'slug'     => $view->getVariable('slug'),
        'layout'   => $event->getViewModel()->getVariables(),
        'headers'  => $response->getHeaders(),
    ];
};

$firstEmbeddable = array_key_first(BlockRegistry::embeddable());
checkIntegration(is_string($firstEmbeddable) && $firstEmbeddable !== '', 'no embeddable block to dispatch');

// 1. A whitelisted slug, no panel, no query: the plain case.
$got = $dispatchEmbed(['block' => $firstEmbeddable], []);
checkIntegration($got['status'] === 200, 'a whitelisted embed did not return 200');
checkIntegration(
    $got['template'] === 'iwac-visualizations/embed/block',
    'a whitelisted embed rendered the wrong template: ' . $got['template']
);
checkIntegration($got['slug'] === $firstEmbeddable, 'the embed view did not receive its slug');
checkIntegration(
    ($got['layout']['embedPanel'] ?? null) === '',
    'a whole-block embed was given a panel'
);
checkIntegration(
    ($got['layout']['embedTheme'] ?? null) === '',
    'no ?theme still set a colour mode'
);
checkIntegration(
    ($got['layout']['embedPrimary'] ?? null) === '',
    'no ?primary still set an accent'
);
checkIntegration(
    strpos((string) $got['headers']->get('Cache-Control')->getFieldValue(), 'max-age=300') !== false,
    'an embed response was not marked cacheable'
);

// 2. Every slug NOT on the whitelist must 404 and render the not-found
// template - including the traversal attempts, since this same map is the
// directory guard for `common/block-layout/<slug>`.
$rejectedSlugs = [
    '',
    'not-a-block',
    'collection-overview/../../../etc/passwd',
    '../config/database.ini',
    'COLLECTION-OVERVIEW',
    'collection_overview',
];
foreach ($rejectedSlugs as $slug) {
    $got = $dispatchEmbed(['block' => $slug], []);
    checkIntegration($got['status'] === 404, "embed slug '{$slug}' did not 404");
    checkIntegration(
        $got['template'] === 'iwac-visualizations/embed/not-found',
        "embed slug '{$slug}' did not render the not-found template"
    );
}

// 3. ?theme: only the two known modes survive; anything else falls back to
// the empty string, which the layout renders as light.
$themeCases = [
    'dark' => 'dark',
    'light' => 'light',
    'DARK' => 'dark',      // lowercased before the comparison
    'Light' => 'light',
    'sepia' => '',
    '1' => '',
    'dark; --x: url(javascript:1)' => '',
    '' => '',
];
foreach ($themeCases as $given => $expected) {
    $got = $dispatchEmbed(['block' => $firstEmbeddable], ['theme' => $given]);
    checkIntegration(
        ($got['layout']['embedTheme'] ?? null) === $expected,
        "?theme={$given} became '" . ($got['layout']['embedTheme'] ?? 'NULL') . "', expected '{$expected}'"
    );
}

// 4. ?primary: a bare or #-prefixed 3/6/8-digit hex, normalised to one
// leading `#`. Everything else is dropped - the value reaches a `style`
// attribute, so a passthrough here would be an injection.
$primaryCases = [
    'ce4115'    => '#ce4115',
    '#ce4115'   => '#ce4115',
    'abc'       => '#abc',
    '#abc'      => '#abc',
    'ce4115ff'  => '#ce4115ff',
    'CE4115'    => '#CE4115',
    'ce41'      => '',           // 4 digits is not a CSS hex colour
    'ce411'     => '',
    'ce4115fff' => '',
    'red'       => '',
    ''          => '',
    'ce4115; background: url(x)' => '',
    '</style><script>alert(1)</script>' => '',
];
foreach ($primaryCases as $given => $expected) {
    $got = $dispatchEmbed(['block' => $firstEmbeddable], ['primary' => $given]);
    checkIntegration(
        ($got['layout']['embedPrimary'] ?? null) === $expected,
        "?primary={$given} became '" . ($got['layout']['embedPrimary'] ?? 'NULL') . "', expected '{$expected}'"
    );
}

// 5. :panel is opaque - embed.js enumerates the names client-side and the
// route constraint is the only validation - but it must reach the layout
// and the title unchanged, and an absent one must stay empty.
$got = $dispatchEmbed(['block' => $firstEmbeddable, 'panel' => 'panel-3'], []);
checkIntegration(
    ($got['layout']['embedPanel'] ?? null) === 'panel-3',
    'the :panel segment did not reach the layout'
);
checkIntegration(
    strpos((string) ($got['layout']['embedTitle'] ?? ''), 'panel-3') !== false,
    'the panel name did not reach the embed title'
);
checkIntegration(
    $got['slug'] === $firstEmbeddable,
    'a single-panel embed changed the block slug'
);

// 6. The whitelist and the registry are the same list, in both directions -
// this is the guard that stopped v1.21 from shipping a 500ing embed.
foreach (array_keys(BlockRegistry::embeddable()) as $slug) {
    $got = $dispatchEmbed(['block' => $slug], []);
    checkIntegration($got['status'] === 200, "registry block '{$slug}' is not dispatchable as an embed");
    // The partial the embed view will actually reach for. Since H5 that is
    // `_generic` for the nineteen blocks whose registry row declares a
    // shell, and a per-slug template for the two that do more than declare
    // - the same rule as embed/block.phtml, asserted here because a block
    // that resolves to nothing 500s every embed of it (v1.21).
    $row = BlockRegistry::get($slug);
    $partial = ($row !== null && !empty($row['shell']))
        ? 'common/block-layout/_generic'
        : 'common/block-layout/' . $slug;
    $resolvedPartial = $renderer->resolver()->resolve($partial, $renderer);
    checkIntegration(
        is_string($resolvedPartial) && is_file($resolvedPartial),
        "embeddable block '{$slug}' has no {$partial} template"
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
