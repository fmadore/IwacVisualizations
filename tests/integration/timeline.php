<?php
declare(strict_types=1);

require rtrim((string) getenv('OMEKA_PATH'), '/\\') . '/bootstrap.php';
$application = \Omeka\Mvc\Application::init(require OMEKA_PATH . '/application/config/application.config.php');
$services = $application->getServiceManager();
$settings = $services->get('Omeka\Settings');
$previousSync = $settings->get('iwacvis_last_sync');
$generation = str_repeat('b', 64);
$directory = rtrim($services->get('Omeka\File\Store')->getLocalPath(''), '/\\')
    . '/iwac-visualizations/generations/' . $generation . '/timelines';
mkdir($directory, 0775, true);
$fixture = json_decode(file_get_contents(__DIR__ . '/../fixtures/timeline.json'), true);
// Independently assert PHP purification rather than trusting the Python output.
$fixture['title']['textHtml'] .= '<script>alert(1)</script><a href="javascript:alert(1)">Unsafe URL</a>';
file_put_contents($directory . '/history.en.json', json_encode($fixture));
file_put_contents($directory . '/index.json', json_encode(['schemaVersion' => 1, 'timelines' => [
    ['slug' => 'history', 'locales' => ['en' => ['title' => 'A history', 'file' => 'history.en.json']]],
]]));
try {
    $settings->set('iwacvis_last_sync', ['generation' => $generation, 'time' => '2026-10-01T00:00:00Z']);
    $api = $services->get('Omeka\ApiManager');
    $site = $api->read('sites', 1)->getContent();
    $page = $api->read('site_pages', 1)->getContent();
    $services->get('ViewHelperManager')->get('currentSite')->setSite($site);
    $renderer = $services->get('ViewRenderer');
    $entity = new \Omeka\Entity\SitePageBlock();
    $entity->setPage($services->get('Omeka\EntityManager')->find(\Omeka\Entity\SitePage::class, 1));
    $entity->setLayout('iwac-timeline');
    $entity->setData(['timeline' => 'history', 'locale' => 'en', 'layout' => 'narrative']);
    $block = new \Omeka\Api\Representation\SitePageBlockRepresentation($entity, $services);
    $handler = $services->get('Omeka\BlockLayoutManager')->get('iwac-timeline');
    $html = $handler->render($renderer, $block);
    foreach (['data-timeline="history"', 'data-event-id="intro"', 'data-event-id="range"', 'timeline.en.min.js'] as $needle) {
        if (strpos($html, $needle) === false) throw new RuntimeException('Timeline render missing ' . $needle);
    }
    if (strpos($html, '<script>alert') !== false || strpos($html, 'javascript:') !== false || strpos($html, 'echarts@') !== false) {
        throw new RuntimeException('Timeline rendered unsafe HTML or fetched an unused chart library.');
    }
    $form = $handler->form($renderer, $site, $page, $block);
    if (strpos($form, 'value="history" selected') === false && strpos($form, 'selected="selected" value="history"') === false) {
        throw new RuntimeException('Timeline editor did not retain the catalogue selection: ' . $form);
    }
    if (isset(\IwacVisualizations\Site\BlockRegistry::embeddable()['iwac-timeline'])) {
        throw new RuntimeException('Configured timeline exposed in the zero-configuration embed gallery.');
    }
    echo "Native timeline: registered editor, active generation, purified reading view and asset plan passed.\n";
} finally {
    $settings->set('iwacvis_last_sync', $previousSync);
    unlink($directory . '/history.en.json');
    unlink($directory . '/index.json');
    rmdir($directory);
    rmdir(dirname($directory));
}
