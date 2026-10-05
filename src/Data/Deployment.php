<?php
declare(strict_types=1);

namespace IwacVisualizations\Data;

/**
 * Immutable data directories; the Omeka setting is the active-generation pointer.
 *
 * One instance describes one installation's data tree: the live directory
 * the browser fetches from (`files/iwac-visualizations/`) and its work
 * sibling (`files/iwac-visualizations.tmp/`, same filesystem, so a rename
 * between them is atomic). The sync job and the admin controller both build
 * it with `forStore()`, so the two paths cannot be derived differently.
 */
class Deployment
{
    /** Subdirectory of the Omeka file store; web-served at {basePath}/files/iwac-visualizations/. */
    const STORE_SUBDIR = 'iwac-visualizations';

    /**
     * The aggregate the store root keeps a copy of, for readers outside this
     * module. See `publishRootSnapshot()`.
     */
    const ROOT_SNAPSHOT = 'collection-overview.json';

    /** @var string */
    private $live;

    public function __construct(string $live)
    {
        $this->live = rtrim($live, '/\\');
    }

    /**
     * The deployment inside an Omeka file store. Throws when the store is not
     * a local one or its directory cannot be resolved: there is nothing to
     * publish into, and nothing to read back.
     */
    public static function forStore($store): self
    {
        if (!is_object($store) || !method_exists($store, 'getLocalPath')) {
            throw new \RuntimeException('The Omeka file store is not a local directory.');
        }
        $filesRoot = rtrim((string) $store->getLocalPath(''), '/\\');
        if ($filesRoot === '' || !is_dir($filesRoot)) {
            throw new \RuntimeException('Could not resolve the Omeka files directory.');
        }
        return new self($filesRoot . '/' . self::STORE_SUBDIR);
    }

    /** The web-served data root. */
    public function liveDir(): string
    {
        return $this->live;
    }

    /** Staging, downloads and the lock: a sibling of the live root. */
    public function workDir(): string
    {
        return $this->live . '.tmp';
    }

    /** The permanent lock inode the job holds and the recovery control probes. */
    public function lockPath(): string
    {
        return $this->workDir() . '/sync.lock';
    }

    /** True for a well-formed generation id: its manifest's SHA-256, in lower-case hex. */
    public static function isGeneration(string $name): bool
    {
        return Manifest::isDigest($name);
    }

    public static function generationPath(?array $sync): string
    {
        $generation = $sync['generation'] ?? '';
        return is_string($generation) && self::isGeneration($generation)
            ? '/generations/' . $generation : '';
    }

    /** Recover old releases interrupted between the legacy two-rename swap. */
    public function recover(): void
    {
        $live = $this->live;
        if (is_file($live . '/' . self::ROOT_SNAPSHOT) || is_dir($live . '/generations')) {
            return;
        }
        $backups = glob($this->workDir() . '/old-*', GLOB_ONLYDIR) ?: [];
        usort($backups, static fn($a, $b) => filemtime($b) <=> filemtime($a));
        foreach ($backups as $backup) {
            if (!is_file($backup . '/' . self::ROOT_SNAPSHOT)) {
                continue;
            }
            if (file_exists($live) || !$this->move($backup, $live)) {
                throw new \RuntimeException('Recovery required; preserved data at ' . $backup);
            }
            return;
        }
    }

    /** Publish without moving or deleting the active generation or legacy tree. */
    public function promote(string $stage, string $generation): string
    {
        if (!self::isGeneration($generation)) {
            throw new \RuntimeException('Invalid generation digest.');
        }
        $root = $this->live . '/generations';
        if (!is_dir($root) && !@mkdir($root, 0775, true) && !is_dir($root)) {
            throw new \RuntimeException('Could not create generation directory.');
        }
        $target = $root . '/' . $generation;
        if (is_dir($target)) {
            if (hash_file('sha256', $target . '/manifest.json') !== $generation) {
                throw new \RuntimeException('Existing generation manifest differs from its digest.');
            }
            Manifest::validate($target);
            touch($target);
            return $target; // Same verified archive: immutable and idempotent.
        }
        if (!$this->move($stage, $target)) {
            throw new \RuntimeException('Could not publish generation; active data is unchanged.');
        }
        touch($target);
        return $target;
    }

    /**
     * Copy the active generation's `collection-overview.json` to the store
     * root, atomically.
     *
     * PUBLISHED CROSS-REPO CONTRACT. The IWAC theme's homepage banner
     * (`helper/BannerStats.php` in IWAC-theme) reads
     * `OMEKA_PATH/files/iwac-visualizations/collection-overview.json` — the
     * ROOT path, not a generation — for its `summary` figures (newspapers,
     * references, words, pages…). Before generations, the sync wrote that
     * file in place. Since v1.66 every sync publishes only under
     * `generations/<sha256>/`, so the root copy froze at its last pre-v1.66
     * snapshot on upgraded installs and never existed on fresh ones, and the
     * banner showed stale counts or hid its cards with no error anywhere.
     * Renaming, moving or no longer writing this file breaks the theme the
     * same way; change both repositories together or not at all.
     *
     * Written to a temporary file in the same directory and renamed over the
     * old copy, so a concurrent banner read sees the old file or the new one,
     * never half of either. Only this one file is touched: the rest of a
     * legacy root tree stays where it is for pages loaded before the upgrade.
     */
    public function publishRootSnapshot(string $generation): void
    {
        if (!self::isGeneration($generation)) {
            throw new \RuntimeException('Invalid generation digest.');
        }
        $source = $this->live . '/generations/' . $generation . '/' . self::ROOT_SNAPSHOT;
        $bytes = is_file($source) ? @file_get_contents($source) : false;
        if (!is_string($bytes)) {
            throw new \RuntimeException('The active generation has no ' . self::ROOT_SNAPSHOT . '.');
        }
        $temp = $this->live . '/.' . self::ROOT_SNAPSHOT . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($temp, $bytes) !== strlen($bytes)) {
            @unlink($temp);
            throw new \RuntimeException('Could not write a temporary copy of ' . self::ROOT_SNAPSHOT . '.');
        }
        if (!$this->move($temp, $this->live . '/' . self::ROOT_SNAPSHOT)) {
            @unlink($temp);
            throw new \RuntimeException('Could not replace the root ' . self::ROOT_SNAPSHOT . '.');
        }
    }

    /** Retain old readers for at least 30 days and always retain the previous generation. */
    public function prune(array $keep, int $now): void
    {
        foreach (glob($this->live . '/generations/*', GLOB_ONLYDIR) ?: [] as $directory) {
            $name = basename($directory);
            if (!self::isGeneration($name) || is_link($directory)
                || in_array($name, $keep, true) || filemtime($directory) >= $now - 30 * 86400
            ) {
                continue;
            }
            self::removeTree($directory);
        }
    }

    /**
     * Delete a directory tree, or a single file. No-op when nothing is there.
     *
     * Never follows a symlink: a link — to a file or to a directory, at the
     * top or anywhere inside — is unlinked itself, and whatever it points at
     * is left alone. The trees this removes are archive extractions and
     * generations under `files/`, and a link planted in one must not turn a
     * cleanup into a delete somewhere else. There used to be two deleters,
     * and only one of them knew that.
     */
    public static function removeTree(string $path): void
    {
        if (is_link($path) || is_file($path)) {
            // A directory link on Windows is removed with rmdir, not unlink.
            if (!@unlink($path) && is_link($path)) {
                @rmdir($path);
            }
            return;
        }
        if (!is_dir($path)) {
            return;
        }
        $entries = @scandir($path);
        foreach ($entries === false ? [] : $entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            self::removeTree($path . '/' . $entry);
        }
        @rmdir($path);
    }

    protected function move(string $from, string $to): bool
    {
        return @rename($from, $to);
    }

    /** A permanent lock inode is shared by the job and the recovery control. */
    public function isLocked(): bool
    {
        if (!is_dir($this->workDir())) {
            return false;
        }
        $handle = @fopen($this->lockPath(), 'c');
        if (!$handle) {
            return true; // Cannot prove the worker is absent.
        }
        $available = flock($handle, LOCK_EX | LOCK_NB);
        if ($available) {
            flock($handle, LOCK_UN);
        }
        fclose($handle);
        return !$available;
    }
}
