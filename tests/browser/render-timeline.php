<?php
/** Regenerate the committed browser fixture from the production PHP partial. */
require_once __DIR__ . '/../../src/Timeline/Catalog.php';

class TimelineFixtureView
{
    public function plugin($name) { return static function ($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }; }
    public function translate($value) { return $value; }
    public function render($timeline, $instance) {
        ob_start();
        include __DIR__ . '/../../view/common/timeline-reading.phtml';
        return ob_get_clean();
    }
}
$timeline = json_decode(file_get_contents($argv[1] ?? __DIR__ . '/../fixtures/timeline.json'), true);
$view = new TimelineFixtureView();
$locale = $timeline['locale'];
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
    <div class="iwac-vis-block iwac-vis-timeline fixture-separator" data-timeline="<?= $timeline['slug'] ?>" data-instance="<?= $instance ?>" data-layout="narrative" data-start-slide="intro">
        <?= $view->render($timeline, $instance) ?>
    </div>
    <?php endforeach; ?>
</main>
<script src="/asset/js/dist/shared-core.<?= $locale ?>.min.js"></script>
<script src="/asset/js/dist/blocks/timeline.<?= $locale ?>.min.js"></script>
</body>
</html>
