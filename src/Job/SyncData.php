<?php
declare(strict_types=1);

namespace IwacVisualizations\Job;

use Omeka\Job\AbstractJob;
use IwacVisualizations\Data\Deployment;
use IwacVisualizations\Data\Manifest;
use ZipArchive;

/**
 * Pull the precomputed visualisation data into the Omeka file store.
 *
 * Python generators publish immutable archives in GitHub Actions. This job
 * verifies and stages an archive, publishes a content-addressed directory,
 * then activates it through one Omeka setting. Existing readers retain their
 * generation URLs; failed imports leave the active setting unchanged.
 *
 * Runs under Omeka's default PhpCli dispatch strategy (a detached CLI
 * process), so it resolves everything from the service locator and never
 * touches view helpers / the HTTP request context.
 */
class SyncData extends AbstractJob
{
    /** Subdirectory of the Omeka file store; web-served at {basePath}/files/iwac-visualizations/. */
    const STORE_SUBDIR = Deployment::STORE_SUBDIR;

    /** Release asset filename produced by .github/workflows/regenerate-data.yml. */
    const ASSET_NAME = 'iwac-data.zip';

    /** The `sha256sum` sidecar the same workflow publishes beside the archive. */
    const CHECKSUM_SUFFIX = '.sha256';

    /** Base for the repository's release downloads. */
    const RELEASE_BASE = 'https://github.com/fmadore/IwacVisualizations/releases/download/';

    /**
     * The entry checked for before extraction — guards against a
     * 404-HTML-as-zip or a truncation. The manifest, because nothing can be
     * published without it: it names and hashes every other entry.
     */
    const MANIFEST_ENTRY = 'manifest.json';

    /**
     * The aggregate every archive must carry (`Manifest::validate()` refuses
     * one without it), and the file the store root keeps a copy of for the
     * theme banner (`Deployment::publishRootSnapshot()`).
     */
    const MARKER_ENTRY = Deployment::ROOT_SNAPSHOT;

    /** Generous extraction ceilings: the normal bundle is ~18k entries / ~120 MB. */
    const MAX_ARCHIVE_ENTRIES = 50000;
    const MAX_ENTRY_BYTES = 536870912;       // 512 MB for one expanded entry
    const MAX_EXTRACTED_BYTES = 2147483648;  // 2 GB expanded in total

    /** Global setting holding the last successful sync (time/count/bytes/tag). */
    const SETTING_LAST_SYNC = 'iwacvis_last_sync';

    public function perform()
    {
        $services = $this->getServiceLocator();
        $logger   = $services->get('Omeka\Logger');

        if (!extension_loaded('zip')) {
            $logger->err('IWAC data sync: the PHP "zip" extension is not installed; cannot unpack the archive.');
            throw new \RuntimeException('Required PHP extension "zip" is missing.');
        }

        $settings   = $services->get('Omeka\Settings');
        // One instance for the whole run: the live root, its work sibling
        // (same filesystem ⇒ atomic rename()) and the lock all derive from it,
        // the same way the admin controller derives them.
        $deployment = $this->deploymentFor($services->get('Omeka\File\Store'));
        $workRoot   = $deployment->workDir();
        if (!is_dir($workRoot) && !@mkdir($workRoot, 0775, true) && !is_dir($workRoot)) {
            throw new \RuntimeException('Could not create work directory: ' . $workRoot);
        }

        $jobId       = (int) $this->job->getId();
        $lockPath    = $deployment->lockPath();
        $zipPath     = $workRoot . '/download-' . $jobId . '.zip';
        $sidecarPath = $zipPath . self::CHECKSUM_SUFFIX;
        $stageDir    = $workRoot . '/stage-' . $jobId;

        // Concurrency guard: a non-blocking exclusive lock. The controller also
        // refuses to dispatch when a sync is running; this covers the residual race.
        $lock = fopen($lockPath, 'c');
        if ($lock === false) {
            throw new \RuntimeException('Could not open lock file: ' . $lockPath);
        }
        if (!flock($lock, LOCK_EX | LOCK_NB)) {
            fclose($lock);
            $logger->warn('IWAC data sync: another sync is already running — aborting.');
            return;
        }

        $tag = trim((string) $this->getArg('tag', ''));

        try {
            $deployment->recover();
            // Sweep whatever a previous run left behind. The temp trees are
            // job-scoped and cleaned in a `finally`, which does not run on SIGKILL
            // or an OOM kill — and the cleanup only ever removed the CURRENT job's
            // siblings, so every hard-killed sync left roughly 18k files under
            // `files/iwac-visualizations.tmp/` forever. Safe to do here: the
            // exclusive lock above means no other sync is using them.
            $swept = $this->sweepStaleWork($deployment, $jobId, $logger);
            if ($swept > 0) {
                $logger->info(sprintf(
                    'IWAC data sync: removed %d orphaned work director%s from an '
                    . 'earlier run that was killed before it could clean up.',
                    $swept,
                    $swept === 1 ? 'y' : 'ies'
                ));
            }

            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before download — aborting.');
                return;
            }

            // 1. Resolve the repository-owned release URL. Do not accept an
            // arbitrary job argument here: background-job arguments can be
            // dispatched outside this controller and would otherwise create
            // a server-side request primitive.
            $tag = $this->resolveTag($tag, $workRoot . '/release-' . $jobId . '.json', $logger);
            $url = self::releaseUrlForTag($tag);

            // 2. The checksum is mandatory and belongs to the resolved release.
            // Fetched FIRST: it is a few bytes, and a release without a usable
            // one should fail now, not after a several-hundred-megabyte download.
            $expectedDigest = $this->fetchDigest($url . self::CHECKSUM_SUFFIX, $sidecarPath, $logger);

            // 3. Stream the archive to a temp file (GitHub asset URLs 302 → CDN).
            $logger->info(sprintf('IWAC data sync: downloading %s', $url));
            $this->download($url, $zipPath, $logger);
            $bytes = is_file($zipPath) ? (int) filesize($zipPath) : 0;
            if ($bytes <= 0) {
                throw new \RuntimeException('Downloaded archive is empty.');
            }
            $logger->info(sprintf('IWAC data sync: downloaded %.1f MB.', $bytes / 1048576));
            $this->verifyDigest($expectedDigest, $zipPath, $logger);

            // 4. Inspect + extract into a fresh staging dir (never the live dir).
            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before extract — aborting.');
                return;
            }
            $zip = new ZipArchive();
            if ($zip->open($zipPath, ZipArchive::CHECKCONS) !== true) {
                throw new \RuntimeException('Downloaded file is not a valid ZIP archive.');
            }
            $count = $zip->numFiles;
            if ($count < 1 || $zip->locateName(self::MANIFEST_ENTRY) === false) {
                $zip->close();
                throw new \RuntimeException('Archive is missing the expected entry "' . self::MANIFEST_ENTRY . '".');
            }
            if ($count > self::MAX_ARCHIVE_ENTRIES) {
                $zip->close();
                throw new \RuntimeException(sprintf(
                    'Archive contains too many entries (%d; maximum %d).',
                    $count,
                    self::MAX_ARCHIVE_ENTRIES
                ));
            }
            // Zip-slip guard: refuse any entry whose path could escape the
            // staging dir (absolute, drive-letter, backslash, or `..`
            // segments), any Unix special file/symlink, or an implausibly
            // large expanded payload. The archive comes from this repo's own
            // release, so this is defense-in-depth — but the job writes into
            // files/, so hostile-archive hygiene is cheap.
            $expandedBytes = 0;
            for ($i = 0; $i < $count; $i++) {
                $name = (string) $zip->getNameIndex($i);
                if (!self::isSafeArchiveEntryPath($name)) {
                    $zip->close();
                    throw new \RuntimeException('Archive contains an unsafe entry path: ' . $name);
                }

                $stat = $zip->statIndex($i);
                if ($stat === false) {
                    $zip->close();
                    throw new \RuntimeException('Could not inspect archive entry: ' . $name);
                }
                $size = (int) ($stat['size'] ?? 0);
                if ($size < 0 || $size > self::MAX_ENTRY_BYTES) {
                    $zip->close();
                    throw new \RuntimeException('Archive entry is too large: ' . $name);
                }
                $expandedBytes += $size;
                if ($expandedBytes > self::MAX_EXTRACTED_BYTES) {
                    $zip->close();
                    throw new \RuntimeException('Archive expands beyond the 2 GB safety limit.');
                }

                $opsys = 0;
                $attributes = 0;
                if ($zip->getExternalAttributesIndex($i, $opsys, $attributes)
                    && $opsys === ZipArchive::OPSYS_UNIX
                    && !self::isSafeUnixArchiveAttributes($attributes)
                ) {
                    $zip->close();
                    throw new \RuntimeException(
                        'Archive contains a symlink or special-file entry: ' . $name
                    );
                }
            }
            // Existing generations already occupy disk; reserve staging plus 10% margin.
            $free = @disk_free_space($workRoot);
            if ($free !== false && $expandedBytes > 0 && $free < $expandedBytes * 1.1) {
                $zip->close();
                throw new \RuntimeException(sprintf(
                    'Not enough free space to extract: %.1f MB available, %.1f MB needed '
                    . '(expanded size plus 10%% margin).',
                    $free / 1048576,
                    ($expandedBytes * 1.1) / 1048576
                ));
            }

            Deployment::removeTree($stageDir);
            if (!@mkdir($stageDir, 0775, true) && !is_dir($stageDir)) {
                $zip->close();
                throw new \RuntimeException('Could not create staging directory: ' . $stageDir);
            }
            if (!$zip->extractTo($stageDir)) {
                $zip->close();
                throw new \RuntimeException('Failed to extract the archive into the staging directory.');
            }
            $zip->close();
            @unlink($zipPath);
            $logger->info(sprintf('IWAC data sync: extracted %d entries.', $count));

            // 5. Validate and publish the content-addressed generation.
            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before publication.');
                return;
            }
            $generation = hash_file('sha256', $stageDir . '/' . self::MANIFEST_ENTRY);
            if (!is_string($generation)) {
                throw new \RuntimeException('Missing data manifest.');
            }
            Manifest::validate($stageDir);
            $deployment->promote($stageDir, $generation);

            // 6. Activate: record success for the admin status panel + the
            // client cache-buster. This setting IS the active-generation pointer.
            $previous = $settings->get(self::SETTING_LAST_SYNC);
            $settings->set(self::SETTING_LAST_SYNC, [
                'generation' => $generation,
                'time'  => gmdate('Y-m-d\TH:i:s\Z'),
                'count' => $count,
                'bytes' => $bytes,
                'tag'   => $tag !== '' ? $tag : 'data',
            ]);

            // 7. Refresh the root collection-overview.json the IWAC theme's
            // homepage banner reads — a cross-repo contract, see
            // Deployment::publishRootSnapshot(). Also on the idempotent
            // same-generation path, so a re-run repairs a stale or missing
            // copy. Activation has already succeeded: a failure here costs the
            // banner fresh figures, not the sync, so it warns and moves on.
            try {
                $deployment->publishRootSnapshot($generation);
            } catch (\Throwable $e) {
                $logger->warn(
                    'IWAC data sync: activated successfully; could not refresh the root '
                    . self::MARKER_ENTRY . ' the theme banner reads: ' . $e->getMessage()
                );
            }

            // 8. Retention.
            try {
                $deployment->prune([$generation, $previous['generation'] ?? ''], time());
            } catch (\Throwable $e) {
                $logger->warn('IWAC data sync: activated successfully; retention cleanup failed: ' . $e->getMessage());
            }
            $logger->info('IWAC data sync: complete.');
        } finally {
            Deployment::removeTree($stageDir); // no-op once renamed into place
            if (is_file($zipPath)) {
                @unlink($zipPath);
            }
            if (is_file($sidecarPath)) {
                @unlink($sidecarPath);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
            // Keep the lock inode: unlinking it permits competing locks.
        }
    }

    /** The data tree this job publishes into. A seam for the fixture tests. */
    protected function deploymentFor($store): Deployment
    {
        return Deployment::forStore($store);
    }

    /**
     * True when a ZIP entry is a relative forward-slash path that cannot
     * escape the staging directory. Kept public and side-effect-free so the
     * security boundary is covered by the dependency-free PHP test runner.
     */
    public static function isSafeArchiveEntryPath(string $name): bool
    {
        return $name !== ''
            && $name[0] !== '/'
            && strpos($name, "\0") === false
            && strpos($name, '\\') === false
            && !preg_match('#(?:^|/)\.\.(?:/|$)#', $name)
            && !preg_match('#^[A-Za-z]:#', $name);
    }

    /**
     * The SHA-256 a `sha256sum` sidecar declares for the archive, or null.
     *
     * Accepts only a well-formed 64-hex digest whose filename column names
     * this archive (`<hex>  iwac-data.zip`, or `*iwac-data.zip` in binary
     * mode), so an HTML error page, a truncated file or a digest for some
     * other asset can never pass as a verification. Public and pure so the
     * dependency-free PHP test runner covers the boundary.
     */
    public static function expectedDigestFromSidecar(string $contents, string $assetName = self::ASSET_NAME): ?string
    {
        foreach (preg_split('/\R/', trim($contents)) ?: [] as $line) {
            if (preg_match('/^([0-9a-f]{64})\s+\*?(\S+)\s*$/i', trim($line), $m)
                && basename($m[2]) === $assetName
            ) {
                return strtolower($m[1]);
            }
        }
        return null;
    }

    /** Build the only permitted download origin for a release tag. */
    public static function releaseUrlForTag(string $tag): string
    {
        $tag = trim($tag);
        return self::RELEASE_BASE
            . ($tag !== '' ? rawurlencode($tag) : 'data')
            . '/' . self::ASSET_NAME;
    }

    /** The moving release contains only a pointer to a fully published immutable pair. */
    protected function resolveTag(string $tag, string $path, $logger): string
    {
        if ($tag !== '' && $tag !== 'data') {
            return $tag;
        }
        try {
            $this->download(self::RELEASE_BASE . 'data/latest.json', $path, $logger);
            return self::tagFromPointer((string) @file_get_contents($path));
        } finally {
            @unlink($path);
        }
    }

    /**
     * The immutable `data-build-<run>-<attempt>` tag a `data/latest.json`
     * pointer names, or a RuntimeException for anything else — malformed
     * JSON, a missing key, or a tag outside the pattern the workflow writes.
     *
     * Pure, and separate from `resolveTag()`, because the fixture job
     * replaces `resolveTag()` to stay off the network — which meant the
     * parsing, the one part with a security boundary (the tag ends up in a
     * download URL), never ran under test.
     */
    public static function tagFromPointer(string $json): string
    {
        try {
            $pointer = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RuntimeException('Invalid data release pointer.', 0, $e);
        }
        $resolved = is_array($pointer) ? ($pointer['tag'] ?? '') : '';
        if (!is_string($resolved) || !preg_match('/^data-build-[0-9]+-[0-9]+$/D', $resolved)) {
            throw new \RuntimeException('Invalid data release pointer.');
        }
        return $resolved;
    }

    /**
     * Accept a Unix ZIP entry only when its mode describes a regular file,
     * directory, or carries no file-type bits. The last form is emitted by
     * some ordinary ZIP creators; explicit symlinks/devices/sockets are not.
     */
    public static function isSafeUnixArchiveAttributes(int $attributes): bool
    {
        $type = ($attributes >> 16) & 0170000;
        return $type === 0 || $type === 0100000 || $type === 0040000;
    }

    /**
     * The digest the release's checksum sidecar declares for the archive.
     * Throws when the sidecar cannot be fetched or does not name this
     * archive: an unverifiable archive is never installed. Protected for the
     * fixture tests, which supply the fixture's own digest.
     */
    protected function fetchDigest(string $sidecarUrl, string $sidecarPath, $logger): string
    {
        try {
            $this->download($sidecarUrl, $sidecarPath, $logger);
        } catch (\RuntimeException $e) {
            @unlink($sidecarPath);
            throw new \RuntimeException('Checksum could not be fetched; active data is unchanged.', 0, $e);
        }
        $expected = self::expectedDigestFromSidecar((string) @file_get_contents($sidecarPath));
        @unlink($sidecarPath);
        if ($expected === null) {
            throw new \RuntimeException(
                'The checksum sidecar is malformed; refusing to install an unverified archive.'
            );
        }
        return $expected;
    }

    /** Require the downloaded archive to match the digest `fetchDigest()` returned. */
    protected function verifyDigest(string $expected, string $zipPath, $logger): void
    {
        $actual = hash_file('sha256', $zipPath);
        if (!is_string($actual) || !hash_equals($expected, strtolower($actual))) {
            throw new \RuntimeException(
                'The archive\'s SHA-256 does not match the published checksum; nothing was installed.'
            );
        }
        $logger->info('IWAC data sync: archive SHA-256 verified.');
    }

    /**
     * Stream a URL to a destination file, retrying once on a transport
     * failure. The job's one network seam — protected so the fixture tests
     * can replace it with a local copy.
     *
     * A 300 MB download over a CDN fails sometimes for reasons that have
     * nothing to do with the archive: a dropped connection, a timeout, a
     * refused TCP handshake. This job runs on a schedule and by hand from an
     * admin screen, and a single blip used to mean a red job and a manual
     * re-run. Only the three transport errno values are retried — 7 (could
     * not connect), 28 (timed out), 56 (receive error) — so an HTTP 404 or a
     * TLS failure still fails immediately, because those will fail again.
     */
    protected function download(string $url, string $dest, $logger): void
    {
        $transient = [7, 28, 56];   // CURLE_COULDNT_CONNECT / OPERATION_TIMEDOUT / RECV_ERROR
        try {
            $this->downloadOnce($url, $dest, $logger);
            return;
        } catch (\RuntimeException $e) {
            if (!in_array($this->lastCurlErrno, $transient, true)) {
                throw $e;
            }
            $logger->warn(sprintf(
                'IWAC data sync: download failed with a transport error (%s) — retrying once.',
                $e->getMessage()
            ));
        }
        @unlink($dest);
        $this->downloadOnce($url, $dest, $logger);
    }

    /**
     * curl errno of the most recent attempt, so `download()` can decide.
     * Protected, with `downloadOnce()`, so the retry policy can be tested
     * against scripted failures instead of a real flaky network.
     */
    protected int $lastCurlErrno = 0;

    /** One transfer attempt; records its curl errno in `$lastCurlErrno`. */
    protected function downloadOnce(string $url, string $dest, $logger): void
    {
        $this->lastCurlErrno = 0;
        if (function_exists('curl_init')) {
            $fp = fopen($dest, 'wb');
            if ($fp === false) {
                throw new \RuntimeException('Could not open temp file for writing: ' . $dest);
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_FILE           => $fp,
                CURLOPT_FOLLOWLOCATION => true,   // GitHub release asset → objects.githubusercontent.com
                CURLOPT_MAXREDIRS      => 5,
                CURLOPT_CONNECTTIMEOUT => 30,
                CURLOPT_TIMEOUT        => 600,
                CURLOPT_FAILONERROR    => true,   // HTTP >= 400 becomes a curl error
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_USERAGENT      => 'IwacVisualizations SyncData',
            ]);
            $ok     = curl_exec($ch);
            $errNo  = curl_errno($ch);
            $this->lastCurlErrno = $errNo;
            $errMsg = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            // No curl_close(): the CurlHandle is freed by GC when it goes out of
            // scope. curl_close() is a deprecated no-op since PHP 8.0 (warns on 8.5).
            fclose($fp);
            // Check the HTTP status first so a 4xx yields a clear message rather
            // than the cryptic "curl 22" that CURLOPT_FAILONERROR produces.
            if ($status >= 400) {
                @unlink($dest);
                $hint = $status === 404
                    ? ' — release asset not found. Run the regenerate-data workflow to'
                      . ' publish iwac-data.zip to the `data` release, then retry.'
                    : '';
                throw new \RuntimeException('Download failed: HTTP ' . $status . $hint);
            }
            if ($ok === false || $errNo !== 0) {
                @unlink($dest);
                throw new \RuntimeException(sprintf('Download failed (curl %d): %s', $errNo, $errMsg ?: 'unknown error'));
            }
            return;
        }

        $logger->warn('IWAC data sync: ext-curl unavailable — falling back to the PHP stream wrapper.');
        $ctx = stream_context_create([
            'http' => [
                'follow_location' => 1,
                'max_redirects'   => 5,
                'timeout'         => 600,
                'user_agent'      => 'IwacVisualizations SyncData',
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        if (!@copy($url, $dest, $ctx)) {
            $err = error_get_last();
            throw new \RuntimeException('Download failed: ' . ($err['message'] ?? 'unknown error'));
        }
    }

    /**
     * The work-directory entries a sync creates, by kind, with the suffixes
     * each may carry. The sweep below recognises exactly these; anything
     * else under the work root is not this job's to delete.
     */
    const WORK_ENTRY_SUFFIXES = [
        'stage'    => [''],
        'old'      => [''],
        'download' => ['.zip', '.zip' . self::CHECKSUM_SUFFIX],
        'release'  => ['.json'],
    ];

    /**
     * Remove work directories and downloads left by a run that never reached
     * its `finally` — a SIGKILL, an OOM kill, a fatal restart.
     *
     * Only entries matching the job-scoped names this class creates are
     * touched, and only ones belonging to a DIFFERENT job id than the current
     * one; the work root is a sibling of the live tree and must never be
     * swept indiscriminately. The exclusive lock held by the caller is what
     * makes this safe: no other sync can be using them.
     *
     * An `old-<id>` holding a `collection-overview.json` is the backup the
     * legacy two-rename swap left, and `Deployment::recover()` can still
     * restore it — but only while no `generations/` exists, since recovery
     * stands down once one does. From then on it is unreachable, so it is
     * swept like any other orphan rather than kept forever.
     *
     * @return int how many entries were removed
     */
    private function sweepStaleWork(Deployment $deployment, int $jobId, $logger): int
    {
        $workRoot = $deployment->workDir();
        $entries = @scandir($workRoot);
        if ($entries === false) {
            return 0;
        }
        $recoverable = !is_dir($deployment->liveDir() . '/generations');
        $removed = 0;
        foreach ($entries as $entry) {
            if (!preg_match('~^(stage|old|download|release)-(\d+)(.*)$~D', $entry, $m)
                || !in_array($m[3], self::WORK_ENTRY_SUFFIXES[$m[1]], true)
            ) {
                continue;   // `.`, `..`, sync.lock, and anything not ours
            }
            if ((int) $m[2] === $jobId) {
                continue;   // this run's own, cleaned by the finally below
            }
            $path = $workRoot . '/' . $entry;
            if ($m[1] === 'old' && $recoverable && is_file($path . '/' . self::MARKER_ENTRY)) {
                continue;   // a legacy backup recover() could still restore
            }
            Deployment::removeTree($path);
            if (!file_exists($path) && !is_link($path)) {
                $removed++;
            } else {
                $logger->warn('IWAC data sync: could not remove stale work entry ' . $path);
            }
        }
        return $removed;
    }
}
