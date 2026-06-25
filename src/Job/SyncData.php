<?php
namespace IwacVisualizations\Job;

use Omeka\Job\AbstractJob;
use ZipArchive;

/**
 * Pull the precomputed visualization data into the Omeka file store.
 *
 * Background to issue #7: the heavy Python generators (UMAP, ForceAtlas2,
 * numpy kNN over the Hugging Face dataset) run in GitHub Actions, never on
 * the production server, and publish their ~18k-file output as a single ZIP
 * on the repository's moving `data` release. This Job is the delivery half:
 * pure server-side I/O — no Python, no compute. It downloads that archive,
 * verifies it, extracts it to a staging directory, and **atomically swaps**
 * it into `files/iwac-visualizations/` so the live site never reads a
 * half-written tree. Every step logs to Omeka\Logger, so progress and
 * failures are visible in Admin → Jobs.
 *
 * Runs under Omeka's default PhpCli dispatch strategy (a detached CLI
 * process), so it resolves everything from the service locator and never
 * touches view helpers / the HTTP request context.
 */
class SyncData extends AbstractJob
{
    /** Subdirectory of the Omeka file store; web-served at {basePath}/files/iwac-visualizations/. */
    const STORE_SUBDIR = 'iwac-visualizations';

    /** Release asset filename produced by .github/workflows/regenerate-data.yml. */
    const ASSET_NAME = 'iwac-data.zip';

    /** Base for the repository's release downloads. */
    const RELEASE_BASE = 'https://github.com/fmadore/IwacVisualizations/releases/download/';

    /** A generated entry that must be present — guards against a 404-HTML-as-zip / truncation. */
    const MARKER_ENTRY = 'collection-overview.json';

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

        /** @var \Omeka\File\Store\Local $store */
        $store     = $services->get('Omeka\File\Store');
        $settings  = $services->get('Omeka\Settings');
        $filesRoot = rtrim((string) $store->getLocalPath(''), '/\\');
        if ($filesRoot === '' || !is_dir($filesRoot)) {
            throw new \RuntimeException('Could not resolve the Omeka files directory.');
        }

        $liveDir  = $filesRoot . '/' . self::STORE_SUBDIR;
        $workRoot = $liveDir . '.tmp';   // sibling of $liveDir ⇒ same filesystem ⇒ atomic rename()
        if (!is_dir($workRoot) && !@mkdir($workRoot, 0775, true) && !is_dir($workRoot)) {
            throw new \RuntimeException('Could not create work directory: ' . $workRoot);
        }

        $jobId    = (int) $this->job->getId();
        $lockPath = $workRoot . '/sync.lock';
        $zipPath  = $workRoot . '/download-' . $jobId . '.zip';
        $stageDir = $workRoot . '/stage-' . $jobId;
        $oldDir   = $workRoot . '/old-' . $jobId;

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
            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before download — aborting.');
                return;
            }

            // 1. Resolve the download URL (explicit url arg > tag > moving `data` release).
            $url = trim((string) $this->getArg('url', ''));
            if ($url === '') {
                $url = self::RELEASE_BASE
                    . ($tag !== '' ? rawurlencode($tag) : 'data')
                    . '/' . self::ASSET_NAME;
            }
            $logger->info(sprintf('IWAC data sync: downloading %s', $url));

            // 2. Stream the archive to a temp file (GitHub asset URLs 302 → CDN).
            $this->download($url, $zipPath, $logger);
            $bytes = is_file($zipPath) ? (int) filesize($zipPath) : 0;
            if ($bytes <= 0) {
                throw new \RuntimeException('Downloaded archive is empty.');
            }
            $logger->info(sprintf('IWAC data sync: downloaded %.1f MB.', $bytes / 1048576));

            // 3. Verify + extract into a fresh staging dir (never the live dir).
            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before extract — aborting.');
                return;
            }
            $zip = new ZipArchive();
            if ($zip->open($zipPath, ZipArchive::CHECKCONS) !== true) {
                throw new \RuntimeException('Downloaded file is not a valid ZIP archive.');
            }
            $count = $zip->numFiles;
            if ($count < 1 || $zip->locateName(self::MARKER_ENTRY) === false) {
                $zip->close();
                throw new \RuntimeException('Archive is missing the expected entry "' . self::MARKER_ENTRY . '".');
            }
            $this->rrmdir($stageDir);
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

            // 4. Atomic swap: move the current tree aside, promote the staged tree.
            //    A request in the sub-millisecond gap 404s, which the client renders
            //    as an empty state — it never sees a half-written tree.
            if ($this->shouldStop()) {
                $logger->info('IWAC data sync: stop requested before swap — aborting (no changes made).');
                return;
            }
            $hadLive = is_dir($liveDir);
            if ($hadLive && !@rename($liveDir, $oldDir)) {
                throw new \RuntimeException('Could not move the current data aside.');
            }
            if (!@rename($stageDir, $liveDir)) {
                if ($hadLive && is_dir($oldDir)) {
                    @rename($oldDir, $liveDir); // best-effort restore
                }
                throw new \RuntimeException('Could not promote the new data into place.');
            }
            $logger->info(sprintf('IWAC data sync: swapped %d files into files/%s.', $count, self::STORE_SUBDIR));

            // 5. Record success for the admin status panel + the client cache-buster.
            $settings->set(self::SETTING_LAST_SYNC, [
                'time'  => gmdate('Y-m-d\TH:i:s\Z'),
                'count' => $count,
                'bytes' => $bytes,
                'tag'   => $tag !== '' ? $tag : 'data',
            ]);
            $logger->info('IWAC data sync: complete.');
        } finally {
            $this->rrmdir($oldDir);
            $this->rrmdir($stageDir); // no-op once renamed into place
            if (is_file($zipPath)) {
                @unlink($zipPath);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
            @unlink($lockPath);
        }
    }

    /**
     * Stream a URL to a destination file, following redirects. Prefers ext-curl
     * (constant memory, fails on HTTP >= 400); falls back to PHP's HTTP stream
     * wrapper, which also follows redirects and streams chunk-by-chunk.
     */
    private function download(string $url, string $dest, $logger): void
    {
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
            $errMsg = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            fclose($fp);
            if ($ok === false || $errNo !== 0) {
                @unlink($dest);
                throw new \RuntimeException(sprintf('Download failed (curl %d): %s', $errNo, $errMsg ?: 'unknown error'));
            }
            if ($status >= 400) {
                @unlink($dest);
                throw new \RuntimeException('Download failed: HTTP ' . $status);
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

    /** Recursively remove a directory tree. No-op if it does not exist. */
    private function rrmdir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            if ($item->isDir()) {
                @rmdir($item->getPathname());
            } else {
                @unlink($item->getPathname());
            }
        }
        @rmdir($dir);
    }
}
