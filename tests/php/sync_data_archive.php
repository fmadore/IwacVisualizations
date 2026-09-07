<?php
declare(strict_types=1);

/**
 * SyncData::perform() against real ZIP fixtures (Tier 8 / B3 (1)).
 *
 * WHAT WAS AND WAS NOT COVERED BEFORE
 * -----------------------------------
 * `run.php` tested the STATIC predicates — `isSafeArchiveEntryPath()`,
 * `isSafeUnixArchiveAttributes()`, `expectedDigestFromSidecar()`,
 * `releaseUrlForTag()`. Those are the right things to test in isolation,
 * and they are not the same thing as testing that `perform()` CALLS them.
 * A refactor that dropped the zip-slip loop, or moved it after
 * `extractTo()`, would leave every one of those assertions green while the
 * job wrote outside its staging directory.
 *
 * So this file drives the real method against archives built here at run
 * time by the real `ZipArchive`, with a real filesystem underneath, and
 * asserts on what ends up on disk.
 *
 * HOW IT AVOIDS THE NETWORK
 * -------------------------
 * `download()` and `verifyDigest()` are the only two methods that reach
 * out; both are `protected` for this reason. `FixtureSyncData` overrides
 * them: the download copies a prepared file into the destination, the
 * digest check is a no-op (its own contract is covered by the sidecar
 * tests in run.php). Everything else — the marker check, the entry
 * ceilings, the zip-slip guard, the symlink refusal, the free-space
 * check, the lock, the two renames and the `finally` sweep — is the
 * shipping code.
 *
 * FIXTURES ARE BUILT, NOT COMMITTED. A hostile zip checked into the repo
 * is a file every scanner and every contributor has to reason about, and
 * one that PHP's own writer produced is a better test of PHP's reader
 * anyway. The `../` and symlink entries need raw writes — ZipArchive's
 * API normalises the first and cannot express the second — so those two
 * are assembled byte by byte below.
 *
 * Included by run.php; uses its `check()` and its stubs.
 */

namespace {

use IwacVisualizations\Job\SyncData;

/** SyncData with the two network methods replaced by a local file copy. */
final class FixtureSyncData extends SyncData
{
    /** @var string Path to the archive `download()` should produce. */
    public $fixture = '';

    /** @var bool Set when download() ran, so a test can prove it was reached. */
    public $downloaded = false;

    protected function download(string $url, string $dest, $logger): void
    {
        $this->downloaded = true;
        if ($this->fixture === '' || !is_file($this->fixture)) {
            throw new \RuntimeException('fixture archive missing: ' . $this->fixture);
        }
        copy($this->fixture, $dest);
    }

    protected function verifyDigest(string $sidecarUrl, string $zipPath, $logger): void
    {
        // Covered on its own by the expectedDigestFromSidecar() checks.
    }
}

/** Collects log lines instead of writing them, and answers like Omeka\Logger. */
final class FakeLogger
{
    public $lines = [];

    public function info($m) { $this->lines[] = 'info: ' . $m; }
    public function warn($m) { $this->lines[] = 'warn: ' . $m; }
    public function err($m)  { $this->lines[] = 'err: ' . $m; }

    public function has(string $needle): bool
    {
        foreach ($this->lines as $line) {
            if (strpos($line, $needle) !== false) return true;
        }
        return false;
    }
}

final class FakeFileStore
{
    private $root;
    public function __construct(string $root) { $this->root = $root; }
    public function getLocalPath($path) { return $this->root . '/' . $path; }
}

final class FakeSettings
{
    public $values = [];
    public function set($key, $value) { $this->values[$key] = $value; }
    public function get($key, $default = null) { return $this->values[$key] ?? $default; }
}

final class FakeServices
{
    public $logger;
    public $store;
    public $settings;

    public function __construct(string $filesRoot)
    {
        $this->logger = new FakeLogger();
        $this->store = new FakeFileStore($filesRoot);
        $this->settings = new FakeSettings();
    }

    public function get($name)
    {
        switch ($name) {
            case 'Omeka\Logger':     return $this->logger;
            case 'Omeka\File\Store': return $this->store;
            case 'Omeka\Settings':   return $this->settings;
        }
        throw new \RuntimeException('unexpected service: ' . $name);
    }
}

final class FakeJobEntity
{
    private $id;
    public function __construct(int $id) { $this->id = $id; }
    public function getId() { return $this->id; }
}

/** A throwaway directory tree, removed when the run ends. */
function syncTempDir(string $label): string
{
    $dir = sys_get_temp_dir() . '/iwac-sync-' . $label . '-' . bin2hex(random_bytes(6));
    mkdir($dir, 0775, true);
    return $dir;
}

function syncRrmdir(string $dir): void
{
    if (!is_dir($dir)) return;
    $items = new \RecursiveIteratorIterator(
        new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
        \RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($dir);
}

/**
 * A well-formed archive. `$entries` is `name => contents`; the marker entry
 * is added unless the caller already named it or passed `false`.
 */
function syncMakeZip(string $path, array $entries, bool $withMarker = true): void
{
    $zip = new \ZipArchive();
    if ($zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
        throw new \RuntimeException('could not create fixture zip at ' . $path);
    }
    if ($withMarker && !array_key_exists(SyncData::MARKER_ENTRY, $entries)) {
        $entries[SyncData::MARKER_ENTRY] = '{"ok":true}';
    }
    foreach ($entries as $name => $contents) {
        $zip->addFromString($name, $contents);
    }
    $zip->close();
}

/**
 * Rewrite an entry name inside a finished archive, in place.
 *
 * ZipArchive refuses to STORE a `..` path, which is the correct behaviour
 * for a writer and useless for testing a reader. So the entry is added
 * under a same-length placeholder and the bytes are patched afterwards, in
 * both the local file header and the central directory. Same length means
 * no offset in the archive moves, so nothing else has to be recomputed.
 */
function syncRenameEntryBytes(string $path, string $from, string $to): void
{
    if (strlen($from) !== strlen($to)) {
        throw new \RuntimeException('entry rename must preserve length');
    }
    $bytes = file_get_contents($path);
    file_put_contents($path, str_replace($from, $to, $bytes));
}

/** Run perform() and return the RuntimeException message, or '' on success. */
function syncRun(FixtureSyncData $job): string
{
    try {
        $job->perform();
        return '';
    } catch (\Throwable $e) {
        return $e->getMessage();
    }
}

/** One isolated scenario: files root, fixture path, job, services. */
function syncScenario(string $label, array $entries, bool $withMarker = true): array
{
    $root = syncTempDir($label);
    $filesRoot = $root . '/files';
    mkdir($filesRoot, 0775, true);
    $fixture = $root . '/fixture.zip';
    syncMakeZip($fixture, $entries, $withMarker);

    $services = new FakeServices($filesRoot);
    $job = new FixtureSyncData($services, [], new FakeJobEntity(7));
    $job->fixture = $fixture;

    return [
        'root'      => $root,
        'filesRoot' => $filesRoot,
        'liveDir'   => $filesRoot . '/' . SyncData::STORE_SUBDIR,
        'fixture'   => $fixture,
        'services'  => $services,
        'job'       => $job,
    ];
}

$syncRoots = [];

// ---------------------------------------------------------------- happy path
$s = syncScenario('ok', [
    'collection-overview.json' => '{"summary":{"newspapers":42}}',
    'nested/dir/on-this-day.json' => '[1,2,3]',
]);
$syncRoots[] = $s['root'];
$err = syncRun($s['job']);

check($err === '', 'a well-formed archive failed to sync: ' . $err);
check($s['job']->downloaded, 'perform() never reached the download seam');
check(
    is_file($s['liveDir'] . '/collection-overview.json'),
    'the marker entry did not land in the live directory'
);
check(
    file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"summary":{"newspapers":42}}',
    'the extracted marker entry does not match the archive'
);
check(
    is_file($s['liveDir'] . '/nested/dir/on-this-day.json'),
    'a nested entry did not survive extraction'
);
check(
    $s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['count'] === 2,
    'the last-sync setting did not record the entry count'
);
check(
    $s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['tag'] === 'data',
    'an empty tag was not recorded as the default "data" release'
);
// The `finally` block must leave nothing behind but the live tree.
check(
    !is_dir($s['filesRoot'] . '/' . SyncData::STORE_SUBDIR . '.tmp/stage-7'),
    'the staging directory outlived a successful sync'
);
check(
    !is_file($s['filesRoot'] . '/' . SyncData::STORE_SUBDIR . '.tmp/download-7.zip'),
    'the downloaded archive was not cleaned up'
);

// ------------------------------------------------- the swap replaces, atomically
$s = syncScenario('replace', ['collection-overview.json' => '{"generation":2}']);
$syncRoots[] = $s['root'];
mkdir($s['liveDir'], 0775, true);
file_put_contents($s['liveDir'] . '/collection-overview.json', '{"generation":1}');
file_put_contents($s['liveDir'] . '/stale.json', 'from the previous release');
$err = syncRun($s['job']);

check($err === '', 'a sync over an existing tree failed: ' . $err);
check(
    file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"generation":2}',
    'the live tree was not replaced by the new archive'
);
check(
    !is_file($s['liveDir'] . '/stale.json'),
    'a file from the previous release survived the swap — the tree was merged, not replaced'
);
check(
    !is_dir($s['filesRoot'] . '/' . SyncData::STORE_SUBDIR . '.tmp/old-7'),
    'the outgoing tree was not swept'
);

// ------------------------------------------------------------ zip slip (`../`)
// ZipArchive will not write `../escape.json`, so it is written as a
// same-length placeholder and patched to `../escape.json` afterwards.
$s = syncScenario('slip', [
    'collection-overview.json' => '{}',
    'xx/escape.json' => 'should never be written',
]);
$syncRoots[] = $s['root'];
syncRenameEntryBytes($s['fixture'], 'xx/escape.json', '../escape.json');
$err = syncRun($s['job']);

check(
    strpos($err, 'unsafe entry path') !== false,
    'an archive with a `../` entry was not refused: ' . ($err ?: '(it succeeded)')
);
check(
    !is_file($s['filesRoot'] . '/escape.json') && !is_file($s['root'] . '/escape.json'),
    'a `../` entry escaped the staging directory'
);
check(
    !is_dir($s['liveDir']),
    'a refused archive still published a live tree'
);

// ------------------------------------------------------------ absolute path
$s = syncScenario('absolute', [
    'collection-overview.json' => '{}',
    'xtmp/evil.json' => 'nope',
]);
$syncRoots[] = $s['root'];
syncRenameEntryBytes($s['fixture'], 'xtmp/evil.json', '/tmp/evil.json');
$err = syncRun($s['job']);
check(
    strpos($err, 'unsafe entry path') !== false,
    'an archive with an absolute entry path was not refused: ' . ($err ?: '(it succeeded)')
);

// ---------------------------------------------------------------- symlink
// A symlink is a Unix mode in the entry's external attributes, which
// ZipArchive can set directly.
$s = syncScenario('symlink', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$zip = new \ZipArchive();
$zip->open($s['fixture']);
$zip->addFromString('link.json', '/etc/passwd');
$zip->setExternalAttributesName(
    'link.json',
    \ZipArchive::OPSYS_UNIX,
    (0120777 << 16) | 0x20
);
$zip->close();
$err = syncRun($s['job']);

check(
    strpos($err, 'symlink or special-file entry') !== false,
    'an archive containing a symlink entry was not refused: ' . ($err ?: '(it succeeded)')
);
check(!is_dir($s['liveDir']), 'a symlink-bearing archive still published a live tree');

// ------------------------------------------------------------ missing marker
$s = syncScenario('nomarker', ['something-else.json' => '{}'], false);
$syncRoots[] = $s['root'];
$err = syncRun($s['job']);
check(
    strpos($err, SyncData::MARKER_ENTRY) !== false,
    'an archive without the marker entry was accepted: ' . ($err ?: '(it succeeded)')
);
check(!is_dir($s['liveDir']), 'a markerless archive still published a live tree');

// ---------------------------------------------------------- truncated archive
// The case the digest sidecar exists for, reaching the reader anyway: a
// body cut off mid-stream. CHECKCONS must reject it.
$s = syncScenario('truncated', [
    'collection-overview.json' => str_repeat('{"pad":"' . str_repeat('x', 200) . '"}', 40),
]);
$syncRoots[] = $s['root'];
$whole = file_get_contents($s['fixture']);
file_put_contents($s['fixture'], substr($whole, 0, (int) (strlen($whole) * 0.6)));
$err = syncRun($s['job']);
check(
    strpos($err, 'not a valid ZIP archive') !== false,
    'a truncated archive was accepted: ' . ($err ?: '(it succeeded)')
);
check(!is_dir($s['liveDir']), 'a truncated archive still published a live tree');

// -------------------------------------------------------------- empty download
$s = syncScenario('empty', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
file_put_contents($s['fixture'], '');
$err = syncRun($s['job']);
check(
    strpos($err, 'empty') !== false,
    'a zero-byte download was accepted: ' . ($err ?: '(it succeeded)')
);

// ------------------------------------------------------- an HTML 404 as a zip
$s = syncScenario('html', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
file_put_contents($s['fixture'], '<html><head><title>Not Found</title></head><body>404</body></html>');
$err = syncRun($s['job']);
check(
    strpos($err, 'not a valid ZIP archive') !== false,
    'a 404 HTML page was accepted as an archive: ' . ($err ?: '(it succeeded)')
);

// ------------------------------------------------------------ the stop switch
// Stop requested before the swap: the job must return without publishing
// anything AND without destroying what is already live.
$s = syncScenario('stop', ['collection-overview.json' => '{"generation":2}']);
$syncRoots[] = $s['root'];
mkdir($s['liveDir'], 0775, true);
file_put_contents($s['liveDir'] . '/collection-overview.json', '{"generation":1}');
$s['job']->stopAfter = 2;   // pass the download and extract checks, stop at the swap
$err = syncRun($s['job']);

check($err === '', 'a stop request raised instead of returning: ' . $err);
check(
    file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"generation":1}',
    'a stop before the swap still replaced the live tree'
);
check(
    $s['services']->logger->has('stop requested before swap'),
    'the stop-before-swap branch did not log'
);
check(
    $s['services']->settings->get(SyncData::SETTING_LAST_SYNC) === null,
    'a stopped sync recorded a successful last-sync time'
);

// ---------------------------------------------------------- the concurrency lock
// A second job while the first holds the lock must decline, not race.
$s = syncScenario('lock', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$workRoot = $s['filesRoot'] . '/' . SyncData::STORE_SUBDIR . '.tmp';
mkdir($workRoot, 0775, true);
$held = fopen($workRoot . '/sync.lock', 'c');
flock($held, LOCK_EX | LOCK_NB);
$err = syncRun($s['job']);
flock($held, LOCK_UN);
fclose($held);

check($err === '', 'a locked-out sync raised instead of returning: ' . $err);
check(
    $s['services']->logger->has('another sync is already running'),
    'a second concurrent sync did not decline'
);
check(!is_dir($s['liveDir']), 'a locked-out sync published a tree anyway');

// ----------------------------------------------------- orphan sweep from a kill
// A tree left by a hard-killed earlier job (a different job id) is swept.
$s = syncScenario('sweep', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$workRoot = $s['filesRoot'] . '/' . SyncData::STORE_SUBDIR . '.tmp';
mkdir($workRoot . '/stage-3/deep', 0775, true);
file_put_contents($workRoot . '/stage-3/deep/leftover.json', 'from a SIGKILLed run');
mkdir($workRoot . '/old-3', 0775, true);
$err = syncRun($s['job']);

check($err === '', 'a sync with orphaned work directories failed: ' . $err);
check(!is_dir($workRoot . '/stage-3'), 'an orphaned staging tree survived the sweep');
check(!is_dir($workRoot . '/old-3'), 'an orphaned outgoing tree survived the sweep');
check(
    $s['services']->logger->has('orphaned work director'),
    'the orphan sweep did not report what it removed'
);

foreach ($syncRoots as $dir) {
    syncRrmdir($dir);
}

}
