<?php
declare(strict_types=1);

namespace IwacVisualizations\Data;

/** Publication contract shared with scripts/validate_data.py. */
final class Manifest
{
    /**
     * The shape of the data this version's JavaScript reads.
     *
     * The generators write their number into manifest.json as `dataContract`
     * (`DATA_CONTRACT` in scripts/validate_data.py; tests/php/run.php fails
     * when the two disagree), and the sync refuses an archive of another
     * contract before extracting it, so the active generation stays live.
     * The data release is built on every push to a generator, not on a
     * module release: without this, a site still on the previous release
     * would pull data its JavaScript cannot read and show empty panels.
     *
     * Bump both, in one commit, when a generator changes a JSON shape the
     * JavaScript reads in a way the previous release cannot follow — a key
     * renamed, retyped or newly required, a different id scheme. An optional
     * key the old JavaScript ignores is not a contract change. A manifest
     * written before the key existed is contract 1.
     */
    public const DATA_CONTRACT = 1;

    /**
     * Refuse a manifest built for another data contract, with what the
     * admin can do about it: upgrade the module, or wait for the data
     * release to be rebuilt.
     */
    public static function assertContract(array $manifest): void
    {
        $contract = array_key_exists('dataContract', $manifest) ? $manifest['dataContract'] : 1;
        if (!is_int($contract) || $contract < 1) {
            throw new \RuntimeException('The data archive declares an invalid data contract.');
        }
        if ($contract === self::DATA_CONTRACT) {
            return;
        }
        throw new \RuntimeException(sprintf(
            'The data archive was built for data contract %d, but this version of IWAC Visualizations reads data contract %d; the active data is unchanged. %s',
            $contract,
            self::DATA_CONTRACT,
            $contract > self::DATA_CONTRACT
                ? 'Upgrade the module to a release that reads it, then pull the data again.'
                : 'Pull again once the data release has been rebuilt by the current generators.'
        ));
    }

    /**
     * A lower-case SHA-256 hex digest — a manifest entry's checksum, and the
     * name of a generation (the digest of its manifest). The one copy of
     * the pattern; `Deployment::isGeneration()` asks this.
     */
    public static function isDigest(string $value): bool
    {
        return (bool) preg_match('/^[a-f0-9]{64}$/D', $value);
    }

    /**
     * A manifest path: segments joined by `/` or `.`, ending in `.json`, so
     * `timelines/hajj-burkina.fr.json` passes while an empty, dot-led or
     * `..` segment cannot.
     */
    public const PATH_PATTERN = '~^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*\.json$~D';

    /** A directory entry a `zip -r` archive carries: safe segments and a trailing slash. */
    private const DIRECTORY_PATTERN = '~^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*/$~D';

    /**
     * The archive entries the sync may extract, read from the manifest
     * INSIDE the archive before anything touches the disk: the manifest
     * itself and every file it lists. Throws when the manifest is missing or
     * malformed.
     *
     * The sync used to extract everything into its staging directory —
     * under `files/`, a publicly served tree — and only then hold the files
     * to the manifest's `.json` allowlist (`validate()`), so a stray entry
     * sat on the web for as long as the validation took (V-15).
     *
     * @return array<string, true>
     */
    public static function allowedEntries(string $manifestJson, string $manifestEntry): array
    {
        $manifest = json_decode($manifestJson, true);
        if (!is_array($manifest) || !is_array($manifest['files'] ?? null) || !$manifest['files']) {
            throw new \RuntimeException('Missing or incompatible data manifest.');
        }
        self::assertContract($manifest);
        $allowed = [$manifestEntry => true];
        foreach (array_keys($manifest['files']) as $path) {
            if (!is_string($path) || !preg_match(self::PATH_PATTERN, $path) || str_contains($path, '..')) {
                throw new \RuntimeException('Invalid manifest entry.');
            }
            $allowed[$path] = true;
        }
        return $allowed;
    }

    /** Whether one archive entry may be extracted, given allowedEntries(). */
    public static function mayExtract(string $name, array $allowed): bool
    {
        if (isset($allowed[$name])) {
            return true;
        }
        return (bool) preg_match(self::DIRECTORY_PATTERN, $name);
    }

    public static function validate(string $directory): array
    {
        $manifest = json_decode((string) @file_get_contents($directory . '/manifest.json'), true);
        if (!is_array($manifest) || ($manifest['schemaVersion'] ?? null) !== 1
            || !is_array($manifest['files'] ?? null) || !$manifest['files']
            || !isset($manifest['files']['collection-overview.json'])
        ) {
            throw new \RuntimeException('Missing or incompatible data manifest.');
        }
        self::assertContract($manifest);
        foreach ($manifest['files'] as $path => $entry) {
            if (!is_string($path) || !preg_match(self::PATH_PATTERN, $path)
                || str_contains($path, '..') || str_starts_with($path, '/')
                || !is_array($entry) || !is_string($entry['sha256'] ?? null)
                || !self::isDigest($entry['sha256'])
            ) {
                throw new \RuntimeException('Invalid manifest entry.');
            }
            // Read once, then hash and parse the same bytes: ~18k files, and a
            // second read of each was the whole cost of the second pass.
            $file = $directory . '/' . $path;
            $bytes = is_file($file) ? @file_get_contents($file) : false;
            if (!is_string($bytes) || !hash_equals($entry['sha256'], hash('sha256', $bytes))) {
                throw new \RuntimeException('Missing or corrupted data file: ' . $path);
            }
            json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
        }
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(
            $directory, \FilesystemIterator::SKIP_DOTS
        ));
        foreach ($iterator as $file) {
            $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($directory) + 1));
            if ($relative !== 'manifest.json' && !isset($manifest['files'][$relative])) {
                throw new \RuntimeException('Unlisted data file: ' . $relative);
            }
        }
        return $manifest;
    }
}
