<?php
declare(strict_types=1);

/** Server-side operator command. Default is a read-only preview; see docs/TIMELINES.md. */
use IwacVisualizations\Timeline\Migration;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$args = getopt('', ['omeka:', 'user-id:', 'apply', 'backup:', 'restore:']);
$root = realpath($args['omeka'] ?? '');
if (!$root || !is_file($root . '/bootstrap.php') || empty($args['user-id'])) {
    fwrite(STDERR, "Usage: php scripts/migrate_timelines.php --omeka=/path/to/omeka --user-id=ADMIN_ID [--apply --backup=/private/backup.json] [--restore=/private/backup.json]\n");
    exit(2);
}
require $root . '/bootstrap.php';
$app = \Omeka\Mvc\Application::init(require $root . '/application/config/application.config.php');
$services = $app->getServiceManager();
$em = $services->get('Omeka\EntityManager');
$db = $em->getConnection();
try {
    $user = $em->find(\Omeka\Entity\User::class, (int) $args['user-id']);
    if (!$user || !$user->isActive() || $user->getRole() !== 'global_admin') {
        throw new RuntimeException('An active global administrator is required.');
    }
    $services->get('Omeka\AuthenticationService')->getStorage()->write($user);
    $api = $services->get('Omeka\ApiManager');
    $changes = [];
    $snapshot = static function ($block): array {
        return ['layout' => $block->getLayout(), 'data' => $block->getData()];
    };
    if (isset($args['restore'])) {
        $backup = json_decode(file_get_contents($args['restore']), true, 512, JSON_THROW_ON_ERROR);
        if (($backup['schemaVersion'] ?? null) !== 1 || ($backup['omekaRoot'] ?? '') !== $root) {
            throw new RuntimeException('Backup does not belong to this installation.');
        }
        foreach ($backup['changes'] as $change) {
            $changes[] = array_merge($change, ['before' => $change['after'], 'after' => $change['before']]);
        }
    } else {
        $catalog = $services->get('ViewHelperManager')->get('iwacTimelineData')->__invoke();
        $config = json_decode(file_get_contents(dirname(__DIR__) . '/config/timelines.json'), true, 512, JSON_THROW_ON_ERROR);
        foreach ($config['timelines'] as $spec) {
            foreach ($spec['sources'] as $locale => $source) {
                if (!$catalog->load($spec['slug'], $locale)) {
                    throw new RuntimeException('Pull the new timeline data before migrating: ' . $spec['slug'] . '/' . $locale);
                }
                $pages = $api->search('site_pages', ['site_slug' => $source['page']['site'], 'slug' => $source['page']['slug']])->getContent();
                if (count($pages) !== 1) {
                    throw new RuntimeException('Expected one page: ' . $source['page']['slug']);
                }
                $page = $pages[0];
                $matched = 0;
                foreach ($page->blocks() as $block) {
                    if ($block->layout() === 'iwac-timeline' && $block->dataValue('timeline') === $spec['slug']
                        && $block->dataValue('locale') === $locale
                    ) {
                        $matched++;
                        continue;
                    }
                    $value = json_decode(json_encode($block, JSON_THROW_ON_ERROR), true);
                    $replacement = Migration::replacement($value, $source['legacySource'], $spec['slug'], $locale);
                    if ($replacement) {
                        $matched++;
                        $changes[] = ['page' => $page->id(), 'block' => $block->id(), 'slug' => $page->slug(),
                            'before' => ['layout' => $value['o:layout'], 'data' => $value['o:data']],
                            'after' => ['layout' => $replacement['o:layout'], 'data' => $replacement['o:data']]];
                    }
                }
                if ($matched !== 1) {
                    throw new RuntimeException('Expected one old or already migrated block on ' . $page->slug());
                }
            }
        }
    }
    foreach ($changes as $change) {
        printf("Page %d (%s), block %d: %s -> %s\n", $change['page'], $change['slug'], $change['block'], $change['before']['layout'], $change['after']['layout']);
    }
    if (!array_key_exists('apply', $args) || !$changes) {
        printf("Preview: %d changes; nothing written.\n", count($changes));
        exit(0);
    }
    // New backup for both migration and restoration. Never overwrite a backup
    // or place page content in the web-served Omeka tree.
    $path = $args['backup'] ?? '';
    $parent = realpath(dirname($path));
    if (!$path || !$parent || $parent === $root || strpos($parent, $root . DIRECTORY_SEPARATOR) === 0) {
        throw new RuntimeException('--backup must name a new file outside the Omeka web tree.');
    }
    $db->beginTransaction();
    $targets = [];
    foreach ($changes as $change) {
        $block = $em->find(\Omeka\Entity\SitePageBlock::class, $change['block']);
        if (!$block || $block->getPage()->getId() !== $change['page']) {
            throw new RuntimeException('Page/block identity changed; nothing applied.');
        }
        $em->refresh($block, \Doctrine\DBAL\LockMode::PESSIMISTIC_WRITE);
        if ($snapshot($block) !== $change['before']) {
            throw new RuntimeException('Page content changed since preview; nothing applied.');
        }
        $targets[] = [$block, $change['after']];
    }
    $oldMask = umask(0077);
    $file = fopen($path, 'x');
    umask($oldMask);
    if (!$file) {
        throw new RuntimeException('Could not create private backup.');
    }
    $json = json_encode(['schemaVersion' => 1, 'omekaRoot' => $root, 'changes' => $changes], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $written = fwrite($file, $json);
    $flushed = fflush($file);
    fclose($file);
    if ($written !== strlen($json) || !$flushed) {
        throw new RuntimeException('Backup could not be written completely; nothing applied.');
    }
    foreach ($targets as [$block, $after]) {
        // Only these two fields change: IDs, positions, page layout, other
        // blocks, attachments and surrounding narrative remain untouched.
        $block->setLayout($after['layout']);
        $block->setData($after['data']);
    }
    $em->flush();
    $db->commit();
    printf("Applied %d changes. Backup: %s\n", count($changes), $path);
} catch (Throwable $error) {
    if ($db->isTransactionActive()) {
        $db->rollBack();
    }
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
