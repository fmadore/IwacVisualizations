<?php
declare(strict_types=1);

namespace IwacVisualizations\Data;

/** Immutable data directories; the Omeka setting is the active-generation pointer. */
class Deployment
{
    public static function generationPath(?array $sync): string
    {
        $generation = $sync['generation'] ?? '';
        return is_string($generation) && preg_match('/^[a-f0-9]{64}$/D', $generation)
            ? '/generations/' . $generation : '';
    }

    /** Recover old releases interrupted between the legacy two-rename swap. */
    public function recover(string $live, string $work): void
    {
        if (is_file($live . '/collection-overview.json') || is_dir($live . '/generations')) {
            return;
        }
        $backups = glob($work . '/old-*', GLOB_ONLYDIR) ?: [];
        usort($backups, static fn($a, $b) => filemtime($b) <=> filemtime($a));
        foreach ($backups as $backup) {
            if (!is_file($backup . '/collection-overview.json')) {
                continue;
            }
            if (file_exists($live) || !$this->move($backup, $live)) {
                throw new \RuntimeException('Recovery required; preserved data at ' . $backup);
            }
            return;
        }
    }

    /** Publish without moving or deleting the active generation or legacy tree. */
    public function promote(string $stage, string $live, string $generation): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $generation)) {
            throw new \RuntimeException('Invalid generation digest.');
        }
        $root = $live . '/generations';
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

    /** Retain old readers for at least 30 days and always retain the previous generation. */
    public function prune(string $live, array $keep, int $now): void
    {
        foreach (glob($live . '/generations/*', GLOB_ONLYDIR) ?: [] as $directory) {
            $name = basename($directory);
            if (!preg_match('/^[a-f0-9]{64}$/D', $name) || is_link($directory)
                || in_array($name, $keep, true) || filemtime($directory) >= $now - 30 * 86400
            ) {
                continue;
            }
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(
                $directory, \FilesystemIterator::SKIP_DOTS
            ), \RecursiveIteratorIterator::CHILD_FIRST);
            foreach ($files as $file) {
                if ($file->isDir() && !$file->isLink()) {
                    @rmdir($file->getPathname());
                } else {
                    @unlink($file->getPathname());
                }
            }
            @rmdir($directory);
        }
    }

    protected function move(string $from, string $to): bool
    {
        return @rename($from, $to);
    }

    /** A permanent lock inode is shared by the job and the recovery control. */
    public static function isLocked(string $work): bool
    {
        if (!is_dir($work)) {
            return false;
        }
        $handle = @fopen($work . '/sync.lock', 'c');
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
