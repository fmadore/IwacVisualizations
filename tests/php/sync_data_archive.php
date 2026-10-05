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
 * `download()` is the job's one network seam and `resolveTag()` the one
 * caller of it with nothing local to say; both are `protected` for this
 * reason. `FixtureSyncData` overrides them: the download copies a prepared
 * file into the destination — or, for the checksum sidecar, writes a
 * `sha256sum` line for that file — and the tag resolves to `data`. So the
 * checksum is fetched, parsed and compared by the shipping code. Everything
 * else — the sidecar-before-archive order, the manifest check, the entry
 * ceilings, the zip-slip guard, the symlink refusal, the free-space check,
 * the lock, the promotion rename, the root snapshot the theme banner reads
 * and the `finally` sweep — is the shipping code too. The pointer parsing
 * `resolveTag()` would do is covered by `tagFromPointer()` in run.php, and
 * the retry policy inside the real `download()` by `RetryProbe` below.
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

use IwacVisualizations\Data\Deployment;
use IwacVisualizations\Job\SyncData;

/** SyncData with the network replaced by a local file copy. */
final class FixtureSyncData extends SyncData
{
    /** @var string Path to the archive `download()` should produce. */
    public $fixture = '';

    /** @var bool Set when the ARCHIVE download ran, so a test can prove it was (not) reached. */
    public $downloaded = false;

    /** @var string[] Every URL asked for, in order. */
    public $urls = [];

    /**
     * @var string|null What the checksum sidecar contains; null means a
     *   correct `sha256sum` line for the fixture, read when it is fetched.
     */
    public $sidecar = null;

    /** @var callable|null Builds the Deployment instead of `forStore()`. */
    public $deploymentFactory = null;

    protected function resolveTag(string $tag, string $path, $logger): string
    {
        return $tag !== '' ? $tag : 'data';
    }

    protected function download(string $url, string $dest, $logger): void
    {
        $this->urls[] = $url;
        if (substr($url, -strlen(self::CHECKSUM_SUFFIX)) === self::CHECKSUM_SUFFIX) {
            file_put_contents($dest, $this->sidecar
                ?? (hash_file('sha256', $this->fixture) . '  ' . self::ASSET_NAME . "\n"));
            return;
        }
        $this->downloaded = true;
        if ($this->fixture === '' || !is_file($this->fixture)) {
            throw new \RuntimeException('fixture archive missing: ' . $this->fixture);
        }
        copy($this->fixture, $dest);
    }

    protected function deploymentFor($store): Deployment
    {
        return $this->deploymentFactory
            ? ($this->deploymentFactory)($store)
            : parent::deploymentFor($store);
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

/**
 * A well-formed archive. `$entries` is `name => contents`; the marker entry
 * is added unless the caller already named it or passed `false`, and the
 * manifest listing every entry is added unless `$withManifest` is false.
 */
function syncMakeZip(string $path, array $entries, bool $withMarker = true, bool $withManifest = true): void
{
    $zip = new \ZipArchive();
    if ($zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
        throw new \RuntimeException('could not create fixture zip at ' . $path);
    }
    if ($withMarker && !array_key_exists(SyncData::MARKER_ENTRY, $entries)) {
        $entries[SyncData::MARKER_ENTRY] = '{"ok":true}';
    }
    $files = [];
    foreach ($entries as $name => $contents) {
        $files[$name] = ['sha256' => hash('sha256', $contents)];
    }
    if ($withManifest) {
        $entries[SyncData::MANIFEST_ENTRY] = json_encode(['schemaVersion' => 1, 'files' => $files]);
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
function syncScenario(string $label, array $entries, bool $withMarker = true, bool $withManifest = true): array
{
    $root = syncTempDir($label);
    $filesRoot = $root . '/files';
    mkdir($filesRoot, 0775, true);
    $fixture = $root . '/fixture.zip';
    syncMakeZip($fixture, $entries, $withMarker, $withManifest);

    $services = new FakeServices($filesRoot);
    $job = new FixtureSyncData($services, [], new FakeJobEntity(7));
    $job->fixture = $fixture;

    return [
        'root'      => $root,
        'filesRoot' => $filesRoot,
        'liveDir'   => $filesRoot . '/' . SyncData::STORE_SUBDIR,
        'workDir'   => $filesRoot . '/' . SyncData::STORE_SUBDIR . '.tmp',
        'fixture'   => $fixture,
        'services'  => $services,
        'job'       => $job,
    ];
}

/** The active generation directory a scenario's last sync recorded. */
function syncGenerationDir(array $s): string
{
    return $s['liveDir'] . Deployment::generationPath($s['services']->settings->get(SyncData::SETTING_LAST_SYNC));
}

$syncRoots = [];

// ---------------------------------------------------------------- happy path
$s = syncScenario('ok', [
    'collection-overview.json' => '{"summary":{"newspapers":42}}',
    'nested/dir/on-this-day.json' => '[1,2,3]',
]);
$syncRoots[] = $s['root'];
$err = syncRun($s['job']);
$generationDir = syncGenerationDir($s);

check($err === '', 'a well-formed archive failed to sync: ' . $err);
check($s['job']->downloaded, 'perform() never reached the download seam');
check(
    is_file($generationDir . '/collection-overview.json'),
    'the marker entry did not land in the live directory'
);
check(
    file_get_contents($generationDir . '/collection-overview.json') === '{"summary":{"newspapers":42}}',
    'the extracted marker entry does not match the archive'
);
check(
    is_file($generationDir . '/nested/dir/on-this-day.json'),
    'a nested entry did not survive extraction'
);
check(
    $s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['count'] === 3,
    'the last-sync setting did not record the entry count'
);
check(
    $s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['tag'] === 'data',
    'an empty tag was not recorded as the default "data" release'
);
// The checksum is fetched FIRST: a few bytes that can fail the run before a
// several-hundred-megabyte download, not after it.
check(
    $s['job']->urls === [
        SyncData::releaseUrlForTag('data') . SyncData::CHECKSUM_SUFFIX,
        SyncData::releaseUrlForTag('data'),
    ],
    'the sidecar was not fetched before the archive: ' . json_encode($s['job']->urls)
);
check($s['services']->logger->has('archive SHA-256 verified'), 'the archive digest was not verified');
// The cross-repo contract: the IWAC theme's homepage banner reads the ROOT
// collection-overview.json (IWAC-theme helper/BannerStats.php), so a fresh
// install must have one, equal to the active generation's.
check(
    @file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"summary":{"newspapers":42}}',
    'a fresh sync did not publish the root collection-overview.json the theme banner reads'
);
check(
    glob($s['liveDir'] . '/.collection-overview.json.*') === [],
    'the root snapshot left its temporary file behind'
);
// The `finally` block must leave nothing behind but the live tree.
check(
    !is_dir($s['workDir'] . '/stage-7'),
    'the staging directory outlived a successful sync'
);
check(
    !is_file($s['workDir'] . '/download-7.zip'),
    'the downloaded archive was not cleaned up'
);
check(
    !is_file($s['workDir'] . '/download-7.zip' . SyncData::CHECKSUM_SUFFIX),
    'the checksum sidecar was not cleaned up'
);

// ---------------------------------------------- an unusable sidecar stops it cold
$s = syncScenario('sidecar', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$s['job']->sidecar = '<html><body>Not Found</body></html>';
$err = syncRun($s['job']);
check(strpos($err, 'malformed') !== false, 'a malformed sidecar was accepted: ' . ($err ?: '(it succeeded)'));
check(!$s['job']->downloaded, 'the archive was downloaded although its checksum was unusable');
check(!is_dir($s['liveDir']), 'an unverifiable archive still published a live tree');

$s = syncScenario('mismatch', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$s['job']->sidecar = str_repeat('0', 64) . '  ' . SyncData::ASSET_NAME;
$err = syncRun($s['job']);
check(strpos($err, 'does not match') !== false, 'an archive with the wrong digest was accepted: ' . ($err ?: '(it succeeded)'));
check(!is_dir($s['liveDir'] . '/generations'), 'an archive with the wrong digest still published a generation');

// ------------------------------------------- the swap publishes beside, not over
$s = syncScenario('replace', ['collection-overview.json' => '{"generation":2}']);
$syncRoots[] = $s['root'];
mkdir($s['liveDir'], 0775, true);
file_put_contents($s['liveDir'] . '/collection-overview.json', '{"generation":1}');
file_put_contents($s['liveDir'] . '/stale.json', 'from the previous release');
$err = syncRun($s['job']);

check($err === '', 'a sync over an existing tree failed: ' . $err);
$generationDir = syncGenerationDir($s);
check(
    file_get_contents($generationDir . '/collection-overview.json') === '{"generation":2}',
    'the live tree was not replaced by the new archive'
);
check(
    !is_file($generationDir . '/stale.json'),
    'a file from the previous release survived the swap — the tree was merged, not replaced'
);
// The root copy the theme banner reads follows the new generation; the rest
// of the legacy root tree stays for pages loaded before the upgrade.
check(
    file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"generation":2}',
    'the root collection-overview.json the theme banner reads stayed frozen at the legacy snapshot'
);
check(
    file_get_contents($s['liveDir'] . '/stale.json') === 'from the previous release',
    'the legacy root tree was pruned; pages loaded before the upgrade still read it'
);
// Promotion is one rename of the staging tree into generations/: the live
// root is never moved aside, so no `old-<id>` backup is ever created.
check(
    glob($s['workDir'] . '/old-*') === [],
    'the sync moved the live tree aside — promotion must publish beside it'
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

// ------------------------------------------------------------ missing manifest
// Checked before anything is extracted: without it nothing can be published.
$s = syncScenario('nomanifest', ['collection-overview.json' => '{}'], true, false);
$syncRoots[] = $s['root'];
$err = syncRun($s['job']);
check(
    strpos($err, SyncData::MANIFEST_ENTRY) !== false,
    'an archive without a manifest was accepted: ' . ($err ?: '(it succeeded)')
);
check(!is_dir($s['liveDir']), 'a manifestless archive still published a live tree');

// ------------------------------------------------------------ missing marker
// A manifest that does not list the overview is refused by Manifest::validate.
$s = syncScenario('nomarker', ['something-else.json' => '{}'], false);
$syncRoots[] = $s['root'];
$err = syncRun($s['job']);
check(
    strpos($err, 'manifest') !== false,
    'an archive without the marker entry was accepted: ' . ($err ?: '(it succeeded)')
);
check(!is_dir($s['liveDir'] . '/generations'), 'a markerless archive still published a generation');

// ---------------------------------------------------------- truncated archive
// The case the digest sidecar exists for, reaching the reader anyway: a
// body cut off mid-stream (with a digest that matches what was cut).
// CHECKCONS must reject it.
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
    $s['services']->logger->has('stop requested before publication'),
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
mkdir($s['workDir'], 0775, true);
$held = fopen($s['workDir'] . '/sync.lock', 'c');
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
// Everything a hard-killed earlier job (a different job id) can leave is
// swept — the staging tree, an empty outgoing tree, the archive, its checksum
// sidecar and the release pointer — and nothing the job did not create is.
$s = syncScenario('sweep', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
$workRoot = $s['workDir'];
mkdir($workRoot . '/stage-3/deep', 0775, true);
file_put_contents($workRoot . '/stage-3/deep/leftover.json', 'from a SIGKILLed run');
mkdir($workRoot . '/old-3', 0775, true);
file_put_contents($workRoot . '/download-3.zip', 'partial archive');
file_put_contents($workRoot . '/download-3.zip' . SyncData::CHECKSUM_SUFFIX, 'partial sidecar');
file_put_contents($workRoot . '/release-3.json', '{"tag":"data-build-1-1"}');
file_put_contents($workRoot . '/notes.txt', 'not the job\'s to delete');
file_put_contents($workRoot . '/stage-3.json', 'not a name the job creates');
$err = syncRun($s['job']);

check($err === '', 'a sync with orphaned work directories failed: ' . $err);
check(!is_dir($workRoot . '/stage-3'), 'an orphaned staging tree survived the sweep');
check(!is_dir($workRoot . '/old-3'), 'an orphaned outgoing tree survived the sweep');
check(!is_file($workRoot . '/download-3.zip'), 'an orphaned archive survived the sweep');
check(
    !is_file($workRoot . '/download-3.zip' . SyncData::CHECKSUM_SUFFIX),
    'an orphaned checksum sidecar survived the sweep'
);
check(!is_file($workRoot . '/release-3.json'), 'an orphaned release pointer survived the sweep');
check(is_file($workRoot . '/notes.txt'), 'the sweep deleted a file the job never creates');
check(is_file($workRoot . '/stage-3.json'), 'the sweep deleted a name outside its own vocabulary');
check(
    $s['services']->logger->has('removed 5 orphaned work director'),
    'the orphan sweep did not report what it removed: ' . implode(' | ', $s['services']->logger->lines)
);

// A legacy `old-<id>` backup is kept only while recover() could still use it:
// before any generations/ exists. Here the root still has its overview, so
// recover() stands down and leaves it, and the sweep must too.
$s = syncScenario('sweep-legacy', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
mkdir($s['liveDir'], 0775, true);
file_put_contents($s['liveDir'] . '/collection-overview.json', '{"legacy":true}');
mkdir($s['workDir'] . '/old-4', 0775, true);
file_put_contents($s['workDir'] . '/old-4/collection-overview.json', '{"backup":true}');
$s['job']->stopAfter = 0;   // sweep, then stop before the download
check(syncRun($s['job']) === '', 'a stopped legacy sweep raised');
check(is_file($s['workDir'] . '/old-4/collection-overview.json'), 'a recoverable legacy backup was swept');

// Once generations/ exists, recover() never looks at old-<id> again, so a
// backup is unreachable and goes like any other orphan.
$s = syncScenario('sweep-unreachable', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
mkdir($s['liveDir'] . '/generations', 0775, true);
mkdir($s['workDir'] . '/old-4', 0775, true);
file_put_contents($s['workDir'] . '/old-4/collection-overview.json', '{"backup":true}');
check(syncRun($s['job']) === '', 'a sync beside an unreachable backup failed');
check(!is_dir($s['workDir'] . '/old-4'), 'an unreachable legacy backup was kept forever');


// Failure injection: failed promotion never disturbs legacy or active data.
class RefusingDeployment extends Deployment
{
    protected function move(string $from, string $to): bool { return false; }
}
$recoveryRoot = syncTempDir('recovery');
$syncRoots[] = $recoveryRoot;
mkdir($recoveryRoot . '/live.tmp/old-1', 0775, true);
file_put_contents($recoveryRoot . '/live.tmp/old-1/collection-overview.json', '{"previous":true}');
try { (new RefusingDeployment($recoveryRoot . '/live'))->recover(); }
catch (\RuntimeException $e) { /* expected */ }
check(is_file($recoveryRoot . '/live.tmp/old-1/collection-overview.json'), 'failed restore deleted the backup');
(new Deployment($recoveryRoot . '/live'))->recover();
check(is_file($recoveryRoot . '/live/collection-overview.json'), 'interrupted legacy swap was not recovered');
mkdir($recoveryRoot . '/stage');
file_put_contents($recoveryRoot . '/stage/collection-overview.json', '{"next":true}');
try { (new RefusingDeployment($recoveryRoot . '/live'))->promote($recoveryRoot . '/stage', str_repeat('a', 64)); }
catch (\RuntimeException $e) { /* expected */ }
check(is_file($recoveryRoot . '/stage/collection-overview.json'), 'failed promotion discarded staging');
check(file_get_contents($recoveryRoot . '/live/collection-overview.json') === '{"previous":true}', 'failed promotion changed active data');

// The work directory and the lock derive from the live root in one place,
// for the job and the admin controller alike.
$derived = Deployment::forStore(new FakeFileStore($recoveryRoot));
check($derived->liveDir() === $recoveryRoot . '/' . Deployment::STORE_SUBDIR, 'forStore() derived the wrong live directory');
check($derived->workDir() === $derived->liveDir() . '.tmp', 'the work directory is no longer the live root\'s sibling');
check($derived->lockPath() === $derived->workDir() . '/sync.lock', 'the lock moved out of the work directory');
try {
    Deployment::forStore(new \stdClass());
    check(false, 'a non-local file store produced a deployment');
} catch (\RuntimeException $e) {
    check(true, 'non-local store refused');
}
check(Deployment::isGeneration(str_repeat('a', 64)), 'a generation id was rejected');
foreach ([str_repeat('A', 64), str_repeat('a', 63), str_repeat('a', 64) . "\n", '../' . str_repeat('a', 61), ''] as $notGeneration) {
    check(!Deployment::isGeneration($notGeneration), 'not a generation id: ' . json_encode($notGeneration));
}

// removeTree() deletes a link, never what it points at.
$tree = syncTempDir('tree');
$outside = syncTempDir('outside');
$syncRoots[] = $tree;
$syncRoots[] = $outside;
mkdir($outside . '/precious', 0775, true);
file_put_contents($outside . '/precious/data.json', 'keep');
file_put_contents($outside . '/file.json', 'keep');
mkdir($tree . '/nested', 0775, true);
file_put_contents($tree . '/nested/own.json', 'delete');
if (function_exists('symlink')
    && @symlink($outside . '/precious', $tree . '/nested/dir-link')
    && @symlink($outside . '/file.json', $tree . '/file-link')
) {
    Deployment::removeTree($tree);
    check(!file_exists($tree) && !is_link($tree . '/nested/dir-link'), 'removeTree() left the tree behind');
    check(
        is_file($outside . '/precious/data.json') && is_file($outside . '/file.json'),
        'removeTree() followed a symlink and deleted outside its tree'
    );
} else {
    Deployment::removeTree($tree);
    check(!file_exists($tree), 'removeTree() left the tree behind');
}

// A manifest cannot authorize missing files, extra executable files or incompatible schemas.
$bad = syncScenario('manifest', ['collection-overview.json' => '{}', 'extra.php' => '<?php exit;']);
$syncRoots[] = $bad['root'];
check(syncRun($bad['job']) !== '', 'an executable archive entry passed manifest validation');

// Repeat imports preserve the same immutable directory, while retention keeps
// both recent readers and the immediately previous generation.
$s = syncScenario('repeat', ['collection-overview.json' => '{"summary":{"newspapers":85}}']);
$syncRoots[] = $s['root'];
check(syncRun($s['job']) === '', 'first immutable import failed');
$first = $s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['generation'];
// The idempotent same-generation path must still refresh the root copy: it
// is how a re-run repairs a banner snapshot that went stale or missing.
file_put_contents($s['liveDir'] . '/collection-overview.json', '{"summary":{"newspapers":81}}');
check(syncRun($s['job']) === '', 'repeated immutable import failed');
check($s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['generation'] === $first, 'repeat changed the generation');
check(
    file_get_contents($s['liveDir'] . '/collection-overview.json') === '{"summary":{"newspapers":85}}',
    'a same-generation re-run did not repair the stale root collection-overview.json'
);
$generationRoot = $s['liveDir'] . '/generations/';
$old = str_repeat('b', 64);
$previous = str_repeat('c', 64);
$recent = str_repeat('d', 64);
foreach ([$old, $previous, $recent] as $id) {
    mkdir($generationRoot . $id);
    file_put_contents($generationRoot . $id . '/data.json', '{}');
    touch($generationRoot . $id, time() - ($id === $recent ? 1 : 40) * 86400);
}
(new Deployment($s['liveDir']))->prune([$first, $previous], time());
check(!is_dir($generationRoot . $old), 'expired unreferenced generation survived retention');
check(is_dir($generationRoot . $previous) && is_dir($generationRoot . $recent), 'retention deleted previous or recent readers');
file_put_contents($generationRoot . $first . '/collection-overview.json', '{"tampered":true}');
check(syncRun($s['job']) !== '', 'repeat import accepted corrupted immutable data');

// The root snapshot is published after activation, so its failure must not
// undo or fail the sync: the generation is live, only the banner is stale.
class RefusingSnapshotDeployment extends Deployment
{
    public function publishRootSnapshot(string $generation): void
    {
        throw new \RuntimeException('disk full');
    }
}
$s = syncScenario('snapshot-fails', ['collection-overview.json' => '{"generation":2}']);
$syncRoots[] = $s['root'];
$s['job']->deploymentFactory = static fn($store) => new RefusingSnapshotDeployment(
    Deployment::forStore($store)->liveDir()
);
$err = syncRun($s['job']);
check($err === '', 'a failed root snapshot failed the whole sync: ' . $err);
check(
    is_string($s['services']->settings->get(SyncData::SETTING_LAST_SYNC)['generation'] ?? null),
    'a failed root snapshot kept the new generation from being activated'
);
check(
    $s['services']->logger->has('could not refresh the root collection-overview.json'),
    'a failed root snapshot was not reported'
);

// A separate PHP process must observe the same persistent lock inode.
$s = syncScenario('crosslock', ['collection-overview.json' => '{}']);
$syncRoots[] = $s['root'];
check(syncRun($s['job']) === '', 'the cross-process lock fixture failed to sync');
$work = $s['workDir'];
$held = fopen($work . '/sync.lock', 'c');
flock($held, LOCK_EX);
$probe = '$f=fopen($argv[1],"c");$ok=flock($f,LOCK_EX|LOCK_NB);echo $ok?"free":"held";fclose($f);';
$process = proc_open([PHP_BINARY, '-r', $probe, $work . '/sync.lock'],
    [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
if (is_resource($process)) {
    fclose($pipes[0]);
    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    check(proc_close($process) === 0 && $output === 'held', 'another process bypassed the persistent lock');
} else {
    check(false, 'could not run the cross-process lock probe');
}
check((new Deployment($s['liveDir']))->isLocked(), 'a held lock reads as free to the recovery control');
flock($held, LOCK_UN);
fclose($held);
check(!(new Deployment($s['liveDir']))->isLocked(), 'released lock remains active');
check(is_file($work . '/sync.lock'), 'lock inode was removed');

/** The sidecar path on its own: fetched, parsed, then compared. */
class ChecksumProbe extends SyncData
{
    public $response;
    public function verify(string $zip): void
    {
        $logger = new FakeLogger();
        $sidecar = $zip . '.probe' . self::CHECKSUM_SUFFIX;
        $this->verifyDigest($this->fetchDigest('fixture', $sidecar, $logger), $zip, $logger);
    }
    protected function download(string $url, string $dest, $logger): void
    {
        if ($this->response === null) throw new \RuntimeException('Transport failed');
        file_put_contents($dest, $this->response);
    }
}
$probe = new ChecksumProbe();
$probeZip = $s['fixture'];
foreach ([null, '<html>Unavailable</html>', str_repeat('0', 64) . '  iwac-data.zip'] as $response) {
    $probe->response = $response;
    try {
        $probe->verify($probeZip);
        check(false, 'missing, malformed or wrong checksum was accepted');
    } catch (\RuntimeException $e) {
        check(true, 'unverifiable checksum rejected');
    }
}
$probe->response = hash_file('sha256', $probeZip) . '  iwac-data.zip';
$probe->verify($probeZip);
check(true, 'matching checksum accepted');
check(!is_file($probeZip . '.probe' . SyncData::CHECKSUM_SUFFIX), 'the fetched sidecar was left on disk');

/**
 * The retry policy inside the real `download()`, against scripted attempts:
 * each entry is a curl errno for a failing attempt, or 0 for success.
 */
class RetryProbe extends SyncData
{
    public $script = [];
    public $attempts = 0;
    public function fetch(string $dest, FakeLogger $logger): void
    {
        $this->download('https://example.invalid/iwac-data.zip', $dest, $logger);
    }
    protected function downloadOnce(string $url, string $dest, $logger): void
    {
        $errno = $this->script[$this->attempts++] ?? 0;
        $this->lastCurlErrno = $errno;
        if ($errno !== 0) {
            throw new \RuntimeException($errno === 22 ? 'Download failed: HTTP 404' : 'Download failed (curl ' . $errno . ')');
        }
        file_put_contents($dest, 'ok');
    }
}
$retryDest = syncTempDir('retry') . '/download.zip';
$syncRoots[] = dirname($retryDest);
foreach ([7, 28, 56] as $transient) {
    $retry = new RetryProbe();
    $retry->script = [$transient, 0];
    $retryLog = new FakeLogger();
    try {
        $retry->fetch($retryDest, $retryLog);
        check($retry->attempts === 2, "a transient curl $transient was not retried exactly once");
        check($retryLog->has('retrying once'), "the curl $transient retry was not logged");
    } catch (\RuntimeException $e) {
        check(false, "a transient curl $transient failed the download: " . $e->getMessage());
    }
}
$retry = new RetryProbe();
$retry->script = [28, 28];
try {
    $retry->fetch($retryDest, new FakeLogger());
    check(false, 'two transient failures in a row still succeeded');
} catch (\RuntimeException $e) {
    check($retry->attempts === 2, 'a transient failure was retried more than once');
}
$retry = new RetryProbe();
$retry->script = [22];   // CURLE_HTTP_RETURNED_ERROR: what a 404 is under FAILONERROR
try {
    $retry->fetch($retryDest, new FakeLogger());
    check(false, 'an HTTP 404 was treated as a success');
} catch (\RuntimeException $e) {
    check($retry->attempts === 1, 'an HTTP 404 was retried; it will fail again');
    check(strpos($e->getMessage(), '404') !== false, 'the 404 lost its message on the way out');
}

foreach ($syncRoots as $dir) {
    Deployment::removeTree($dir);
}

}
