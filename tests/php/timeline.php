<?php
require_once __DIR__ . '/../../src/Timeline/Catalog.php';
require_once __DIR__ . '/../../src/Timeline/Migration.php';
require_once __DIR__ . '/../../src/Timeline/Sources.php';
require_once __DIR__ . '/../lib/fake-items.php';

use IwacVisualizations\Tests\FakeApi;
use IwacVisualizations\Tests\FakeItem;
use IwacVisualizations\Tests\FakeValue;
use IwacVisualizations\Timeline\Catalog;
use IwacVisualizations\Timeline\Migration;
use IwacVisualizations\Timeline\Sources;

check(Catalog::validDate(['value' => '2000-02-29', 'precision' => 'day']), 'leap date rejected');
check(!Catalog::validDate(['value' => '1900-02-29', 'precision' => 'day']), 'invalid leap date accepted');
check(!Catalog::validDate(['value' => '1970-02', 'precision' => 'year']), 'precision mismatch accepted');
check(Catalog::dateLabel(['value' => '1996-04', 'precision' => 'month'], 'fr') === 'avril 1996', 'French partial date changed');
check(Catalog::safeUrl('javascript:alert(1)') === '', 'unsafe media URL accepted');
check(Catalog::safeUrl('https://user:pass@example.com/a.jpg') === '', 'URL credentials accepted');
// The axis card's thumbnail, and the introduction's collage (issue #30).
$image = static function (string $id, string $url, string $caption = '') {
    return ['id' => $id, 'headline' => "Event $id", 'displayDate' => '', 'start' => ['value' => '1970', 'precision' => 'year'],
        'media' => ['type' => 'image', 'url' => $url, 'thumbnail' => '', 'captionHtml' => $caption]];
};
check(Catalog::thumbnail(['type' => 'image', 'url' => 'https://islam.zmo.de/files/large/abc.jpg'])
    === 'https://islam.zmo.de/files/square/abc.jpg', 'an IWAC image must use its square derivative');
check(Catalog::thumbnail(['type' => 'image', 'url' => 'https://example.org/a.jpg', 'thumbnail' => 'https://example.org/t.jpg'])
    === 'https://example.org/t.jpg', "another host's image must use the sheet's thumbnail");
check(Catalog::thumbnail(['type' => 'map', 'url' => 'https://www.google.com/maps/x']) === '', 'a map has no thumbnail');
check(Catalog::thumbnail(null) === '', 'no media, no thumbnail');
check(Catalog::leadImage(['type' => 'image', 'url' => 'https://islam.zmo.de/files/medium/abc.jpg'])
    === 'https://islam.zmo.de/files/large/abc.jpg', 'the lead clipping must use the large derivative');
check(Catalog::leadImage(['type' => 'image', 'url' => 'https://example.org/a.jpg', 'thumbnail' => 'https://example.org/t.jpg'])
    === 'https://example.org/a.jpg', "another host's lead image must be the image itself, not its thumbnail");
check(Catalog::leadImage(['type' => 'map', 'url' => 'https://www.google.com/maps/x']) === '', 'a map has no lead image');
$pictured = static function (int $count, int $plain = 0) use ($image) {
    $events = [];
    for ($i = 0; $i < $count; $i++) {
        $events[] = $image("e$i", "https://islam.zmo.de/files/large/$i.jpg");
        if ($i < $plain) $events[] = ['id' => "t$i", 'media' => null];
    }
    return $events;
};
check(Catalog::collage([['id' => 'a', 'media' => null], ['id' => 'b', 'media' => ['type' => 'link', 'url' => 'https://x.org']]]) === [],
    'a timeline without images must have no collage');
foreach ([1 => 1, 2 => 2, 3 => 3, 4 => 3, 5 => 3, 6 => 6, 8 => 6, 9 => 9, 15 => 9] as $available => $expected) {
    check(count(Catalog::collage($pictured($available, 3))) === $expected,
        "$available images must make a collage of $expected (a mosaic without a hole)");
}
$spread = array_column(Catalog::collage($pictured(15)), 'id');
check(count(array_unique($spread)) === 9 && $spread[0] === 'e0' && end($spread) === 'e14',
    'the collage must spread over the whole chronology, first and last included');
check($spread === array_values(array_filter(array_column($pictured(15), 'id'), static fn ($id) => in_array($id, $spread, true))),
    'the collage must keep the chronological order');

// The source list: items cited in image captions, resolved through the API.
$sourceTimeline = ['events' => [
    $image('later', 'https://islam.zmo.de/files/large/1.jpg',
        '<a href="https://islam.zmo.de/s/westafrica/item/8377" title="x">Savadogo, “Ces Burkinabè oubliés”</a>'),
    $image('earlier', 'https://islam.zmo.de/files/large/2.jpg',
        '<a href="https://islam.zmo.de/s/afrique_ouest/item/6738/">“Départ des pèlerins”</a> and <a href="https://islam.zmo.de/s/westafrica/item/8377">again</a>'),
    ['id' => 'prose', 'media' => null, 'textHtml' => '<a href="https://islam.zmo.de/s/westafrica/item/277">Arabia</a>'],
    $image('private', 'https://islam.zmo.de/files/large/3.jpg', '<a href="https://islam.zmo.de/s/westafrica/item/999">Private</a>'),
    $image('foreign', 'https://islam.zmo.de/files/large/4.jpg',
        '<a href="https://example.org/s/x/item/5">Elsewhere</a> <a href="https://islam.zmo.de/s/westafrica/item-set/2201">Sidwaya</a>'),
]];
check(Sources::itemIds($sourceTimeline) === [8377 => ['later', 'earlier'], 6738 => ['earlier'], 999 => ['private']],
    'only IWAC item links in captions are sources — not prose, item sets or other hosts');
check(Sources::itemIds(['events' => [['id' => 'a', 'media' => null]]]) === [], 'no captions, no sources');
$sidwaya = new FakeValue('Sidwaya');
$api = new FakeApi([
    new FakeItem(8377, 'Ces Burkinabè oubliés du Soudan', [
        'dcterms:date' => [new FakeValue('2001-02-20')], 'dcterms:publisher' => [$sidwaya],
        'dcterms:creator' => [new FakeValue('', new FakeItem(1, 'Kimségninga Savadogo'))],
    ], 'https://islam.zmo.de/files/large/8377.jpg'),
    new FakeItem(6738, 'Départ des Pélerins pour la Mecque', [
        'dcterms:date' => [new FakeValue('1962-04')], 'dcterms:publisher' => [new FakeValue('Carrefour africain')],
    ]),
    new FakeItem(277, 'Arabie saoudite'),
]);
$french = static fn ($item) => $item->id() === 8377 ? 'fr' : 'not a tag';
$cards = Sources::cards($sourceTimeline, $api, 'fr', $french);
check($api->queries === [['items', ['id' => [8377, 6738, 999]]]], 'the source list must read its items in one API search');
check(array_column($cards, 'id') === [6738, 8377], 'sources must be ordered by date, and a private item must drop out');
check($cards[1] === ['id' => 8377, 'url' => '/s/westafrica/item/8377', 'title' => 'Ces Burkinabè oubliés du Soudan',
    'lang' => 'fr', 'thumbnail' => 'https://islam.zmo.de/files/large/8377.jpg', 'creators' => ['Kimségninga Savadogo'],
    'publisher' => 'Sidwaya', 'date' => '20 février 2001', 'events' => ['later', 'earlier']],
    'a source card must carry its title, linked creator, newspaper and date in the timeline language: ' . json_encode($cards[1]));
check($cards[0]['date'] === 'avril 1962' && $cards[0]['lang'] === '' && $cards[0]['thumbnail'] === '',
    'a month stays a month; an invalid language tag and a missing thumbnail stay empty');
check(Sources::cards(['events' => []], $api, 'en') === [] && count($api->queries) === 1,
    'a timeline citing nothing must not query the API');
$dateless = Sources::cards(['events' => [$image('a', 'u', '<a href="https://islam.zmo.de/s/w/item/277">x</a>'),
    $image('b', 'u', '<a href="https://islam.zmo.de/s/w/item/6738">y</a>')]], $api, 'en');
check(array_column($dateless, 'id') === [6738, 277] && $dateless[0]['date'] === 'April 1962',
    'a dateless source must come last');
$themeRoot = sys_get_temp_dir() . '/iwac-timeline-theme-' . getmypid();
@mkdir($themeRoot . '/asset/js/dist', 0777, true);
check(Sources::themeScripts(null) === [] && Sources::themeScripts($themeRoot) === [],
    'a theme without the masonry scripts must get no script tags');
touch($themeRoot . '/asset/js/minimasonry.min.js');
check(Sources::themeScripts($themeRoot) === [], 'half the masonry pair must not be enqueued');
touch($themeRoot . '/asset/js/dist/media-masonry.min.js');
check(Sources::themeScripts($themeRoot) === Sources::THEME_SCRIPTS, "IWAC-theme's masonry scripts must be enqueued");
unlink($themeRoot . '/asset/js/dist/media-masonry.min.js');
unlink($themeRoot . '/asset/js/minimasonry.min.js');
rmdir($themeRoot . '/asset/js/dist');
rmdir($themeRoot . '/asset/js');
rmdir($themeRoot . '/asset');
rmdir($themeRoot);

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

// The browser spec drives a fixture rendered from the templates; a stale one
// would test markup the site no longer prints.
$timelineFixture = dirname(__DIR__) . '/browser/fixtures/timeline.html';
$freshTimeline = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/browser/render-timeline.php'));
check(is_string($freshTimeline) && is_readable($timelineFixture)
    && str_replace("\r\n", "\n", $freshTimeline) === str_replace("\r\n", "\n", (string) file_get_contents($timelineFixture)),
    'timeline.html is stale — php tests/browser/render-timeline.php > tests/browser/fixtures/timeline.html');
