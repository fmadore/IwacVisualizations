<?php
declare(strict_types=1);

// Use Omeka's actual Laminas form/CSRF validators, not the unit-test stubs.
require rtrim((string) getenv('OMEKA_PATH'), '/\\') . '/vendor/autoload.php';
require dirname(__DIR__, 2) . '/src/Controller/Admin/DataController.php';

$controller = new class(null) extends \IwacVisualizations\Controller\Admin\DataController {
    public function url()
    {
        return new class {
            public function fromRoute($route) { return '/admin/iwac-visualizations/sync'; }
        };
    }
};
$method = new ReflectionMethod($controller, 'getSyncForm');
$cases = [
    'normal pull: blank tag, recovery field not rendered' => [['tag' => ''], true],
    'explicit release tag without recovery field' => [['tag' => 'data-build-123-1'], true],
    'recovery unchecked' => [['tag' => '', 'recover' => '0'], true],
    'recovery checked' => [['tag' => '', 'recover' => '1'], true],
    'invalid recovery value' => [['tag' => '', 'recover' => 'unexpected'], false],
    'missing CSRF token' => [['tag' => '', 'sync_token' => null], false],
    'invalid CSRF token' => [['tag' => '', 'sync_token' => 'invalid'], false],
];
$failures = [];
foreach ($cases as $name => [$data, $expected]) {
    $rendered = $method->invoke($controller);
    $rendered->prepare();
    $token = $rendered->get('sync_token')->getValue();
    if (!array_key_exists('sync_token', $data)) {
        $data['sync_token'] = $token;
    } elseif ($data['sync_token'] === null) {
        unset($data['sync_token']);
    }
    $submitted = $method->invoke($controller);
    $submitted->setData($data);
    if ($submitted->isValid() !== $expected) {
        $failures[] = $name . ': ' . json_encode($submitted->getMessages());
    }
}
// Do not emit output before CSRF has finished using the session.
if ($failures) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    exit(1);
}
echo count($cases) . " real-framework sync form checks passed.\n";
