<?php
declare(strict_types=1);

namespace IwacVisualizations\Data;

/** Publication contract shared with scripts/validate_data.py. */
final class Manifest
{
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
            if (!is_string($path) || !preg_match('~^[a-zA-Z0-9_/-]+\.json$~D', $path)
                || str_contains($path, '..') || str_starts_with($path, '/')
                || !is_array($entry) || !is_string($entry['sha256'] ?? null)
                || !preg_match('/^[a-f0-9]{64}$/D', $entry['sha256'])
            ) {
                throw new \RuntimeException('Invalid manifest entry.');
            }
            $file = $directory . '/' . $path;
            $digest = is_file($file) ? hash_file('sha256', $file) : false;
            if (!is_string($digest) || !hash_equals($entry['sha256'], $digest)) {
                throw new \RuntimeException('Missing or corrupted data file: ' . $path);
            }
            json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
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
