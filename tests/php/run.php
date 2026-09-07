<?php
declare(strict_types=1);

// Dependency-free behavioral smoke tests. Minimal framework stubs let the
// module's pure contracts run on CI without bundling Omeka's Laminas/PSR
// dependencies inside the module (which would collide with Omeka at runtime).

namespace Laminas\Mvc {
    class MvcEvent {}
}

namespace Laminas\Mvc\Controller {
    abstract class AbstractActionController {}
}

namespace Laminas\EventManager {
    interface SharedEventManagerInterface {}

    class Event
    {
        private $params;

        public function __construct(array $params = [])
        {
            $this->params = $params;
        }

        public function getParam(string $name)
        {
            return $this->params[$name] ?? null;
        }

        public function setParam(string $name, $value): void
        {
            $this->params[$name] = $value;
        }
    }
}

namespace Omeka\Module {
    abstract class AbstractModule
    {
        public function onBootstrap(\Laminas\Mvc\MvcEvent $event): void {}
    }
}

namespace Omeka\Job {
    /**
     * Enough of Omeka's AbstractJob for SyncData::perform() to run: the
     * service locator, the job entity it reads an id from, the argument bag
     * and the stop flag. Real Omeka gives all four; stubbing them is what
     * lets the archive handling be tested without a database (B3 (1)).
     */
    abstract class AbstractJob
    {
        protected $job;
        private $services;
        private $args;
        public $stopAfter = null;
        public $stopCalls = 0;

        public function __construct($services = null, array $args = [], $job = null)
        {
            $this->services = $services;
            $this->args = $args;
            $this->job = $job;
        }

        public function getServiceLocator()
        {
            return $this->services;
        }

        public function getArg($name, $default = null)
        {
            return $this->args[$name] ?? $default;
        }

        /**
         * False, unless a test asked to stop at the Nth call - which is how
         * the "stop requested before swap" branch is reached deliberately
         * rather than by timing.
         */
        public function shouldStop()
        {
            $this->stopCalls++;
            return $this->stopAfter !== null && $this->stopCalls > $this->stopAfter;
        }
    }
}

namespace Omeka\Api\Representation {
    abstract class AbstractResourceEntityRepresentation {}
}

namespace Laminas\View\Renderer {
    class PhpRenderer
    {
        public $lastPartial;
        public $lastVariables;

        public function partial(string $name, array $variables = []): string
        {
            $this->lastPartial = $name;
            $this->lastVariables = $variables;
            return $name;
        }
    }
}

namespace Omeka\Site\ResourcePageBlockLayout {
    interface ResourcePageBlockLayoutInterface
    {
        public function getLabel(): string;
        public function getCompatibleResourceNames(): array;
        public function render(
            \Laminas\View\Renderer\PhpRenderer $view,
            \Omeka\Api\Representation\AbstractResourceEntityRepresentation $resource
        ): string;
    }
}

namespace {
    use IwacVisualizations\Job\SyncData;
    use IwacVisualizations\Module;
    use IwacVisualizations\Sentiment\Centralite;
    use IwacVisualizations\Sentiment\Polarite;
    use IwacVisualizations\Sentiment\Subjectivite;
    use IwacVisualizations\Site\BlockRegistry;
    use IwacVisualizations\Site\ResourcePageBlockLayout\SentimentExtractor;
    use IwacVisualizations\Site\ResourcePageBlockLayout\Visualizations;
    use Laminas\EventManager\Event;
    use Laminas\View\Renderer\PhpRenderer;
    use Omeka\Api\Representation\AbstractResourceEntityRepresentation;

    $root = dirname(__DIR__, 2);
    require $root . '/src/Sentiment/Polarite.php';
    require $root . '/src/Sentiment/Centralite.php';
    require $root . '/src/Sentiment/Subjectivite.php';
    require $root . '/src/Mvc/EmbedFramingListener.php';
    require $root . '/Module.php';
    require $root . '/src/Site/BlockRegistry.php';
    require $root . '/src/Site/ResourcePageBlockLayout/SentimentExtractor.php';
    require $root . '/src/Site/ResourcePageBlockLayout/Visualizations.php';
    require $root . '/src/Controller/Admin/DataController.php';
    require $root . '/src/Job/SyncData.php';

    $failures = [];
    $checks = 0;

    function check(bool $condition, string $message): void
    {
        global $failures, $checks;
        $checks++;
        if (!$condition) {
            $failures[] = $message;
        }
    }

    final class FakeLinkedResource
    {
        private $id;
        private $title;

        public function __construct(int $id, string $title)
        {
            $this->id = $id;
            $this->title = $title;
        }

        public function id(): int
        {
            return $this->id;
        }

        public function displayTitle(): string
        {
            return $this->title;
        }
    }

    final class FakeValue
    {
        private $text;
        private $resource;

        public function __construct(string $text = '', $resource = null)
        {
            $this->text = $text;
            $this->resource = $resource;
        }

        public function valueResource()
        {
            return $this->resource;
        }

        public function __toString(): string
        {
            return $this->text;
        }
    }

    final class FakeItem extends AbstractResourceEntityRepresentation
    {
        public $calls = [];
        private $values;

        public function __construct(array $values)
        {
            $this->values = $values;
        }

        public function value(string $property, array $options = [])
        {
            $this->calls[$property] = ($this->calls[$property] ?? 0) + 1;
            if (!array_key_exists($property, $this->values)) {
                throw new \RuntimeException('Property absent from test template');
            }
            return $this->values[$property];
        }
    }

    final class FakeTemplate
    {
        private $id;

        public function __construct(int $id)
        {
            $this->id = $id;
        }

        public function id(): int
        {
            return $this->id;
        }
    }

    final class FakeTemplateResource extends AbstractResourceEntityRepresentation
    {
        private $template;

        public function __construct(?int $templateId)
        {
            $this->template = $templateId === null ? null : new FakeTemplate($templateId);
        }

        public function resourceTemplate()
        {
            return $this->template;
        }
    }

    // Controlled-vocabulary lookup and default metadata filtering.
    check(Module::getPolariteLabel(78040) === 'Negative', 'polarity item mapping drifted');

    // The three sentiment axes are enums (Tier 8 / H4). What matters is not
    // that a `match` compiles but that the closed set still holds the same
    // vocabulary: the item ids the dataset points at, one label and one
    // ordinal per case, and NOTHING outside the set resolving to a rating.
    check(count(Polarite::cases()) === 6, 'the polarity vocabulary changed size');
    check(count(Centralite::cases()) === 5, 'the centrality vocabulary changed size');
    check(count(Subjectivite::cases()) === 5, 'the subjectivity vocabulary changed size');
    check(
        array_map(static fn ($c) => $c->value, Polarite::cases())
            === [78031, 78038, 78039, 78040, 78041, 78042],
        'the polarity item ids drifted from the controlled vocabulary'
    );
    check(
        array_map(static fn ($c) => $c->value, Centralite::cases())
            === [78048, 78049, 78050, 78051, 78052],
        'the centrality item ids drifted from the controlled vocabulary'
    );
    check(
        array_map(static fn ($c) => $c->value, Subjectivite::cases())
            === [78043, 78044, 78045, 78046, 78047],
        'the subjectivity item ids drifted from the controlled vocabulary'
    );
    // Every label distinct, or `ordinalForLabel` would answer for the wrong
    // case - it resolves by label because that is the key the extractor has.
    foreach ([Polarite::class, Centralite::class, Subjectivite::class] as $enum) {
        $labels = array_map(static fn ($c) => $c->label(), $enum::cases());
        check(count(array_unique($labels)) === count($labels), "$enum has duplicate labels");
        check(!in_array('', $labels, true), "$enum has an empty label");
    }
    // The two rated scales run 1..5 with no gaps; polarity adds the
    // deliberate off-scale 0.
    check(
        array_values(array_diff(
            array_map(static fn ($c) => $c->ordinal(), Polarite::cases()), [0]
        )) === [5, 4, 3, 2, 1],
        'the polarity scale is no longer a gapless 1-5 plus the off-scale 0'
    );
    check(
        array_map(static fn ($c) => $c->ordinal(), Centralite::cases()) === [5, 4, 3, 2, 1],
        'the centrality scale is no longer a gapless 1-5'
    );
    check(
        Polarite::fromItemId(78042)?->ordinal() === 0,
        '"Not applicable" stopped being off the scale'
    );
    // An id outside the vocabulary must resolve to nothing, not to a rating.
    foreach ([null, 0, -1, 78030, 78053, 999999] as $stranger) {
        check(Polarite::fromItemId($stranger) === null, "polarity accepted item id " . var_export($stranger, true));
        check(Centralite::fromItemId($stranger) === null, "centrality accepted item id " . var_export($stranger, true));
        check(Subjectivite::fromItemId($stranger) === null, "subjectivity accepted item id " . var_export($stranger, true));
    }
    check(Polarite::ordinalForLabel('nonsense') === 0, 'an unknown polarity label scored');
    check(Polarite::ordinalForLabel(null) === 0, 'a null polarity label scored');
    check(Centralite::ordinalForLabel('very central') === 0, 'centrality label lookup went case-insensitive');
    check(
        Subjectivite::fromItemId(78045)?->info() === ['score' => 3, 'label' => 'Mixed'],
        'the subjectivity info shape the article partial reads changed'
    );
    check(Module::getCentraliteNumeric('Very central') === 5, 'centrality scale drifted');
    check(Module::getPolariteNumeric('Not applicable') === 0, 'off-scale polarity drifted');

    $csp = Module::relaxFrameAncestorsPolicies([
        "default-src 'self'; frame-ancestors 'self'; img-src data:",
        "script-src 'none', default-src https:; frame-ancestors https://slides.example",
    ]);
    check(
        $csp[0] === "default-src 'self'; frame-ancestors *; img-src data:",
        'existing CSP directives were not preserved while relaxing framing'
    );
    check(
        $csp[1] === "script-src 'none'; frame-ancestors *, default-src https:; frame-ancestors *",
        'every policy in a CSP policy list must relax frame-ancestors'
    );
    check(
        Module::relaxFrameAncestorsPolicies([]) === ['frame-ancestors *'],
        'missing CSP did not receive a framing policy'
    );

    // Both annotation generations must stay out of the default metadata
    // table: generation 1 still exists on many items, so hiding only the
    // models the panel renders would dump its raw ratings back onto the
    // page the moment the panel's model set changes.
    $event = new Event(['values' => [
        'dcterms:title' => ['kept'],
        'iwac:geminiPolarite' => ['hidden'],
        'iwac:mistralSubjectiviteJustification' => ['hidden'],
        'iwac:gpt56LunaPolarite' => ['hidden'],
        'iwac:deepseekV4Flash0731SubjectiviteJustification' => ['hidden'],
        'iwac:deepseekV4FlashCentralite' => ['hidden'],
        // Gemma joined the panel mid-campaign. A stem missing from
        // SENTIMENT_MODEL_STEMS is not a quiet degradation: its six raw
        // rating rows, justification prose included, appear on every
        // article the run has reached.
        'iwac:gemma431bItCentraliteJustification' => ['hidden'],
        'iwac:qwen3827bPolariteJustification' => ['hidden'],
    ]]);
    (new Module())->filterSentimentValues($event);
    $filtered = $event->getParam('values');
    check(isset($filtered['dcterms:title']), 'ordinary metadata was removed');
    check(count($filtered) === 1, 'a sentiment property survived the metadata filter');

    // The extractor should resolve every property once, not repeat Omeka
    // value lookups for an ID and then again for its display label.
    $item = new FakeItem([
        'iwac:gpt56LunaPolarite' => [new FakeValue('', new FakeLinkedResource(78040, 'Négatif'))],
        'iwac:gpt56LunaCentralite' => [new FakeValue('', new FakeLinkedResource(78048, 'Très central'))],
        'iwac:gpt56LunaSubjectiviteScore' => [new FakeValue('', new FakeLinkedResource(78047, 'Très subjectif'))],
        'iwac:gpt56LunaPolariteJustification' => [new FakeValue('polarity reason')],
        'iwac:gpt56LunaCentraliteJustification' => [new FakeValue('centrality reason')],
        'iwac:gpt56LunaSubjectiviteJustification' => [new FakeValue('subjectivity reason')],
    ]);
    $bundle = SentimentExtractor::fromItem($item);
    check($bundle['gpt56Luna']['polarite'] === 'Negative', 'extractor polarity label is wrong');
    check($bundle['gpt56Luna']['polarite_fr'] === 'Négatif', 'extractor lost the raw French label');
    check($bundle['gpt56Luna']['polarite_numeric'] === 2, 'extractor polarity score is wrong');
    check($bundle['gpt56Luna']['centralite_numeric'] === 5, 'extractor centrality score is wrong');
    check($bundle['gpt56Luna']['subjectivite_score'] === 5, 'extractor subjectivity score is wrong');
    check($bundle['gpt56Luna']['rated'] === true, 'rated model was marked empty');
    check($bundle['deepseekV4Flash0731']['rated'] === false, 'empty model was marked rated');
    check(SentimentExtractor::hasAny($bundle), 'rated bundle was considered empty');
    foreach ($item->calls as $property => $count) {
        check($count === 1, $property . ' was read more than once');
    }

    // Every model the panel renders must have its display chrome, and
    // every logo it names must exist — a missing file renders as a
    // broken image in every sentiment lane on the site.
    foreach (SentimentExtractor::MODELS as $model) {
        check(isset(SentimentExtractor::MODEL_INFO[$model]), "MODEL_INFO is missing '$model'");
        $logo = $root . '/asset/img/ai-logos/' . SentimentExtractor::MODEL_INFO[$model]['logo'];
        check(is_readable($logo), "logo for '$model' is missing: $logo");
    }

    // Registry/dispatch contracts used by both normal blocks and embeds.
    check(count(BlockRegistry::slugs()) === 21, 'page-block registry count drifted');
    check(BlockRegistry::get('laicite')['invokable'] === 'laicite', 'laicite registry entry drifted');
    check(isset(BlockRegistry::embeddable()['press-reprints']), 'press-reprints embed disappeared');
    check(BlockRegistry::get('collection-overview')['invokable'] === 'collectionOverview', 'registry invokable drifted');

    // H5: nineteen blocks declare their whole shell in the registry and
    // render through `_generic`; the two that do more than declare keep
    // their own template. Both halves are asserted, because a block with
    // NEITHER renders nothing and a block with BOTH renders the wrong one.
    $shellRows = 0;
    $ownTemplate = 0;
    foreach (BlockRegistry::slugs() as $slug) {
        $row = BlockRegistry::get($slug);
        $tpl = $root . '/view/common/block-layout/' . $slug . '.phtml';
        if (!empty($row['shell'])) {
            $shellRows++;
            check(!is_readable($tpl), "$slug: has a registry shell AND a $slug.phtml");
            check(!isset($row['shell']['embedSlug']),
                "$slug: shell declares embedSlug, which _generic already supplies");
            check(isset($row['shell']['assets']['bundle']),
                "$slug: shell names no bundle");
        } else {
            $ownTemplate++;
            check(is_readable($tpl), "$slug: no registry shell and no $slug.phtml");
        }
    }
    check($shellRows === 19, "expected 19 generic blocks, found $shellRows");
    check($ownTemplate === 2, "expected 2 blocks with their own template, found $ownTemplate");
    check(is_readable($root . '/view/common/block-layout/_generic.phtml'),
        '_generic.phtml is missing — nineteen blocks render through it');

    $visualizations = new Visualizations();
    $view = new PhpRenderer();
    $rendered = $visualizations->render($view, new FakeTemplateResource(15));
    check(
        $rendered === 'common/resource-page-block-layout/visualizations/minimal-item',
        'photograph template no longer dispatches to minimal-item'
    );
    check($visualizations->render($view, new FakeTemplateResource(999)) === '', 'unknown template should render nothing');

    // Class 38 spans two templates since 2026-08-12: 19 (deposited
    // recordings) and 23 (YouTube uploads). Template 23 went unmapped at
    // first, so every YouTube item page rendered the block as nothing.
    check(
        $visualizations->render($view, new FakeTemplateResource(23))
            === 'common/resource-page-block-layout/visualizations/minimal-item',
        'YouTube video template (23) no longer dispatches to minimal-item'
    );
    check(
        $visualizations->render($view, new FakeTemplateResource(19))
            === 'common/resource-page-block-layout/visualizations/minimal-item',
        'video recording template (19) no longer dispatches to minimal-item'
    );

    // Every mapped template must resolve to a partial that exists on
    // disk. A template added to the map with a typo'd or missing partial
    // 500s the item page rather than rendering nothing, which is the
    // failure mode the block's "unmapped templates are silent" rule does
    // NOT protect against.
    foreach (Visualizations::TEMPLATE_PARTIALS as $templateId => $partial) {
        $path = $root . '/view/common/resource-page-block-layout/visualizations/' . $partial . '.phtml';
        check(is_readable($path), "template $templateId maps to a missing partial: $partial.phtml");
        check(
            $visualizations->render($view, new FakeTemplateResource((int) $templateId))
                === 'common/resource-page-block-layout/visualizations/' . $partial,
            "template $templateId did not dispatch to $partial"
        );
    }

    // ZIP extraction boundary.
    foreach ([
        'collection-overview.json',
        'article-dashboards/123.json',
        'on-this-day/h/01-01.json',
    ] as $safe) {
        check(SyncData::isSafeArchiveEntryPath($safe), 'safe ZIP path rejected: ' . $safe);
    }
    foreach ([
        '',
        '/absolute.json',
        '../escape.json',
        'nested/../../escape.json',
        'C:/windows.json',
        'nested\\windows.json',
        "nul\0byte.json",
    ] as $unsafe) {
        check(!SyncData::isSafeArchiveEntryPath($unsafe), 'unsafe ZIP path accepted: ' . $unsafe);
    }
    check(SyncData::isSafeUnixArchiveAttributes(0100644 << 16), 'regular ZIP entry rejected');
    check(SyncData::isSafeUnixArchiveAttributes(0040755 << 16), 'ZIP directory rejected');
    check(!SyncData::isSafeUnixArchiveAttributes(0120777 << 16), 'ZIP symlink accepted');
    check(!SyncData::isSafeUnixArchiveAttributes(0140777 << 16), 'ZIP socket accepted');
    check(
        SyncData::releaseUrlForTag('')
            === 'https://github.com/fmadore/IwacVisualizations/releases/download/data/iwac-data.zip',
        'default sync release URL drifted'
    );
    check(
        SyncData::releaseUrlForTag('../foreign host')
            === 'https://github.com/fmadore/IwacVisualizations/releases/download/..%2Fforeign%20host/iwac-data.zip',
        'release tag was not confined to one encoded path segment'
    );

    // The checksum sidecar: only a well-formed digest that names THIS archive
    // counts, in either sha256sum column format; anything else is "no digest".
    $hex = str_repeat('a', 64);
    check(
        SyncData::expectedDigestFromSidecar($hex . "  iwac-data.zip\n") === $hex,
        'sha256sum sidecar not parsed'
    );
    check(
        SyncData::expectedDigestFromSidecar(strtoupper($hex) . " *iwac-data.zip") === $hex,
        'binary-mode sidecar not parsed (or digest not normalised to lower case)'
    );
    check(
        SyncData::expectedDigestFromSidecar("garbage\n" . $hex . "  ./iwac-data.zip") === $hex,
        'sidecar with a leading path or a preceding junk line rejected'
    );
    check(SyncData::expectedDigestFromSidecar($hex . "  other.zip") === null, 'digest for another asset accepted');
    check(SyncData::expectedDigestFromSidecar('<html><body>Not Found</body></html>') === null, 'HTML error page accepted as a digest');
    check(SyncData::expectedDigestFromSidecar(str_repeat('b', 63) . "  iwac-data.zip") === null, 'short digest accepted');
    check(SyncData::expectedDigestFromSidecar('') === null, 'empty sidecar accepted');

    check(
        in_array('stopping', \IwacVisualizations\Controller\Admin\DataController::ACTIVE_STATUSES, true),
        'a stopping sync is not treated as active'
    );

    // SyncData::perform() against real ZIP fixtures. Kept in its own file:
    // it needs a dozen fakes and a temp-directory lifecycle, which would
    // dwarf the pure contracts above.
    require __DIR__ . '/sync_data_archive.php';

    if ($failures) {
        fwrite(STDERR, "\nPHP behavioral tests failed:\n");
        foreach ($failures as $failure) {
            fwrite(STDERR, '  - ' . $failure . "\n");
        }
        exit(1);
    }

    echo sprintf("PHP behavioral tests passed: %d checks\n", $checks);
}
