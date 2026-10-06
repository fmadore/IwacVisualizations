<?php
declare(strict_types=1);

namespace IwacVisualizations\Data;

/** Publication contract shared with scripts/validate_data.py. */
final class Manifest
{
    /**
     * A lower-case SHA-256 hex digest — a manifest entry's checksum, and the
     * name of a generation (the digest of its manifest). The one copy of
     * the pattern; `Deployment::isGeneration()` asks this.
     */
    public static function isDigest(string $value): bool
    {
        return (bool) preg_match('/^[a-f0-9]{64}$/D', $value);
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
        foreach ($manifest['files'] as $path => $entry) {
            // Segments joined by `/` or `.`, so `timelines/hajj-burkina.fr.json`
            // passes while an empty, dot-led or `..` segment cannot.
            if (!is_string($path) || !preg_match('~^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*\.json$~D', $path)
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
