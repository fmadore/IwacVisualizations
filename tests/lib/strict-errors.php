<?php
declare(strict_types=1);

/**
 * Every notice, warning and deprecation is a test failure: without this an
 * "Undefined array key" inside a predicate prints, `check()` still sees the
 * value it fell back to, and the harness exits 0. `@`-suppressed diagnostics
 * stay suppressed.
 *
 * Deprecations are ours to fix only when this module raises them. The
 * integration suites boot a real Omeka S (4.0.0 on PHP 8.1, 4.2.1 on 8.5),
 * whose own code and vendor/ tree may deprecate things on a newer PHP; those
 * are ignored. A warning or notice fails wherever it is raised, since the
 * module's own call can be what provokes one inside the core. CI mounts the
 * checkout as modules/IwacVisualizations through a symlink, so a file under
 * that path is the module's too.
 *
 * Adapted from DRE Visualizations' tests/lib/strict-errors.php, which ignores
 * vendor/ deprecations only: its integration suites do not boot Omeka.
 */
error_reporting(E_ALL);
$iwacModuleRoot = str_replace('\\', '/', dirname(__DIR__, 2)) . '/';
set_error_handler(static function (int $severity, string $message, string $file, int $line) use ($iwacModuleRoot): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    if ($severity & (E_DEPRECATED | E_USER_DEPRECATED)) {
        $path = str_replace('\\', '/', $file);
        $ours = (str_starts_with($path, $iwacModuleRoot) || str_contains($path, '/modules/IwacVisualizations/'))
            && !str_contains($path, '/vendor/');
        if (!$ours) {
            return true;
        }
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});
unset($iwacModuleRoot);
