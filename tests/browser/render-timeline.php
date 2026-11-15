<?php
/**
 * Regenerate the committed browser fixtures from the production PHP partials.
 *
 *     php tests/browser/render-timeline.php > tests/browser/fixtures/timeline.html
 *     php tests/browser/render-timeline.php --local-media > tests/browser/fixtures/timeline-lighthouse.html
 *
 * The first cites its media on example.org, so the browser spec can exercise
 * media that fail to load. That makes it a poor page to budget: a failing
 * image is not cached, so each one is requested once or twice depending on
 * timing, and scripts/check-lighthouse.js saw 9, 10 or 11 requests between
 * runs. `--local-media` renders the same page with the two images served by
 * the fixture server (tests/browser/fixtures/media/), which is the page
 * Lighthouse measures.
 */
require_once __DIR__ . '/../../src/Timeline/Catalog.php';
require_once __DIR__ . '/../../src/Site/ItemValue.php';
require_once __DIR__ . '/../../src/Timeline/Sources.php';
require_once __DIR__ . '/../lib/fake-items.php';

use IwacVisualizations\Tests\FakeApi;
use IwacVisualizations\Tests\FakeItem;
use IwacVisualizations\Tests\FakeValue;
use IwacVisualizations\Timeline\Sources;

class TimelineFixtureView
{
    public function plugin($name) { return static function ($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }; }
    public function translate($value) { return $value; }
    public function render($timeline, $instance) {
        ob_start();
        include __DIR__ . '/../../view/common/timeline-reading.phtml';
        return ob_get_clean();
    }
    /** The source list the block template appends (no theme scripts: the fixture has no theme). */
    public function renderSources(array $sources, $instance) {
        $scripts = [];
        ob_start();
        include __DIR__ . '/../../view/common/timeline-sources.phtml';
        return ob_get_clean();
    }
}
$args = array_slice($argv, 1);
$localMedia = in_array('--local-media', $args, true);
$paths = array_values(array_filter($args, static fn (string $arg): bool => $arg !== '--local-media'));
$media = static fn (string $text): string => $localMedia
    ? str_replace(['https://example.org/', 'https:\\/\\/example.org\\/'], ['/tests/browser/fixtures/media/', '\\/tests\\/browser\\/fixtures\\/media\\/'], $text)
    : $text;
$timeline = json_decode($media(file_get_contents($paths[0] ?? __DIR__ . '/../fixtures/timeline.json')), true);
$view = new TimelineFixtureView();
$locale = $timeline['locale'];
// The item the fixture's one caption cites (item/42), as the API returns it.
$sources = Sources::cards($timeline, new FakeApi([
    new FakeItem(42, 'Archival document', [
        'dcterms:date' => [new FakeValue('1970-03-14')],
        'dcterms:publisher' => [new FakeValue('Carrefour africain')],
        'dcterms:creator' => [new FakeValue('A. Reporter')],
    ], $media('https://example.org/archive-page.jpg')),
]), $locale);
?>
<!doctype html>
<html lang="<?= $locale ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>IWAC timeline fixture</title>
    <link rel="stylesheet" href="/asset/css/iwac-embed-tokens.css">
    <link rel="stylesheet" href="/asset/css/iwac-core.min.css">
    <link rel="stylesheet" href="/asset/css/blocks/iwac-timeline.min.css">
    <style>body { margin:0; padding:1rem; background:var(--background); color:var(--ink); } main { max-width:72rem; margin:auto; } .fixture-separator { margin-top:4rem; }</style>
</head>
<body data-theme="light">
<main>
    <h1>Islam West Africa Collection</h1>
    <button id="theme" type="button" onclick="document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark'">Theme</button>
    <?php foreach (['block-1', 'block-2'] as $instance): ?>
    <div class="iwac-vis-block iwac-vis-timeline fixture-separator" data-timeline="<?= $timeline['slug'] ?>" data-instance="<?= $instance ?>" data-layout="narrative" data-start-slide="intro"<?php if ($instance === 'block-1'): // the first block is embeddable, as on a site page ?> data-embed-slug="iwac-timeline" data-embed-base="/s/iwac" data-embed-query="timeline=<?= $timeline['slug'] ?>" data-embed-whole="" data-embed-own="1"<?php endif; ?>>
        <?= $view->render($timeline, $instance) ?>
        <?= $view->renderSources($sources, $instance) ?>
    </div>
    <?php endforeach; ?>
</main>
<script src="/asset/js/dist/shared-core.<?= $locale ?>.min.js"></script>
<script src="/asset/js/dist/blocks/timeline.<?= $locale ?>.min.js"></script>
</body>
</html>
