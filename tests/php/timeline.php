<?php
require_once __DIR__ . '/../../src/Timeline/Catalog.php';
require_once __DIR__ . '/../../src/Timeline/Migration.php';

use IwacVisualizations\Timeline\Catalog;
use IwacVisualizations\Timeline\Migration;

check(Catalog::validDate(['value' => '2000-02-29', 'precision' => 'day']), 'leap date rejected');
check(!Catalog::validDate(['value' => '1900-02-29', 'precision' => 'day']), 'invalid leap date accepted');
check(!Catalog::validDate(['value' => '1970-02', 'precision' => 'year']), 'precision mismatch accepted');
check(Catalog::dateLabel(['value' => '1996-04', 'precision' => 'month'], 'fr') === 'avril 1996', 'French partial date changed');
check(Catalog::safeUrl('javascript:alert(1)') === '', 'unsafe media URL accepted');
check(Catalog::safeUrl('https://user:pass@example.com/a.jpg') === '', 'URL credentials accepted');
$html = '<p><iframe src="https://cdn.knightlab.com/libs/timeline3/latest/embed/index.html?source=known&amp;lang=en"></iframe></p>';
$block = ['o:layout' => 'html', 'o:data' => ['html' => $html], 'o:layout_data' => ['grid_column_span' => '12'], 'o:attachment' => []];
$replacement = Migration::replacement($block, 'known', 'history', 'en');
check($replacement['o:layout'] === 'iwac-timeline', 'legacy embed did not migrate');
check($replacement['o:layout_data'] === $block['o:layout_data'], 'migration altered block placement');
check(Migration::replacement($replacement, 'known', 'history', 'en') === null, 'migration not idempotent');
foreach ([$html . '<p>Keep this prose</p>', $html . '<img src="keep.jpg">', str_replace('cdn.knightlab.com', 'evil.example', $html), $html . $html] as $unsafe) {
    try {
        Migration::replacement(array_replace($block, ['o:data' => ['html' => $unsafe]]), 'known', 'history', 'en');
        check(false, 'migration accepted changed or mixed-content embed');
    } catch (RuntimeException $e) {
        check(true, 'unsafe migration rejected');
    }
}
$temporary = sys_get_temp_dir() . '/iwac-timeline-' . bin2hex(random_bytes(6));
mkdir($temporary . '/timelines', 0700, true);
try {
    $payload = json_decode(file_get_contents(__DIR__ . '/../fixtures/timeline.json'), true);
    file_put_contents($temporary . '/timelines/index.json', json_encode(['schemaVersion' => 1, 'timelines' => [
        ['slug' => 'history', 'locales' => ['en' => ['file' => '../untrusted.json']]],
    ]]));
    file_put_contents($temporary . '/timelines/history.en.json', json_encode($payload));
    $called = 0;
    $catalog = new Catalog($temporary, static function ($html) use (&$called) { $called++; return strip_tags($html, '<p><blockquote><a>'); });
    check($catalog->load('../history', 'en') === null, 'catalogue traversal accepted');
    check($catalog->load('history', 'de') === null, 'unknown locale accepted');
    check($catalog->load('history', 'en')['title']['id'] === 'intro', 'catalogue did not use its fixed safe filename');
    check($called >= count($payload['events']) + 1, 'render boundary did not sanitize every event');
    $payload['events'][0]['start']['value'] = '1970-99';
    file_put_contents($temporary . '/timelines/history.en.json', json_encode($payload));
    $invalid = new Catalog($temporary, 'strip_tags');
    check($invalid->load('history', 'en') === null, 'malformed date rendered');
} finally {
    foreach (glob($temporary . '/timelines/*') as $path) unlink($path);
    rmdir($temporary . '/timelines');
    rmdir($temporary);
}
