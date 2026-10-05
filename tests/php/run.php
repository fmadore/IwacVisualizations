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
    use IwacVisualizations\Controller\Admin\DataController;
    use IwacVisualizations\Job\SyncData;
    use IwacVisualizations\Module;
    use IwacVisualizations\Mvc\EmbedFramingListener;
    use IwacVisualizations\Sentiment\Centralite;
    use IwacVisualizations\Sentiment\Polarite;
    use IwacVisualizations\Sentiment\Subjectivite;
    use IwacVisualizations\Site\AssetPlan;
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
    // Do not preload ModelRegistry: constructing Module must work before its
    // namespace autoloader is registered during a real Omeka cold boot.
    require $root . '/Module.php';
    $coldModule = new \IwacVisualizations\Module();
    require $root . '/src/Site/BlockRegistry.php';
    require $root . '/src/Site/AssetPlan.php';
    require $root . '/src/Site/ResourcePageBlockLayout/SentimentExtractor.php';
    require $root . '/src/Site/ResourcePageBlockLayout/Visualizations.php';
    require $root . '/src/Controller/Admin/DataController.php';
    require $root . '/src/Data/Deployment.php';
    require $root . '/src/Data/Manifest.php';
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
    check(Polarite::fromItemId(78040)?->label() === 'Negative', 'polarity item mapping drifted');

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
    check(Centralite::ordinalForLabel('Very central') === 5, 'centrality scale drifted');
    check(Polarite::ordinalForLabel('Not applicable') === 0, 'off-scale polarity drifted');
    // The five `Module::get*` shims these used to go through are gone, as is
    // the deprecated CSP alias, and nothing may call them back into existence.
    foreach (['getCentraliteLabel', 'getPolariteLabel', 'getSubjectiviteInfo',
        'getCentraliteNumeric', 'getPolariteNumeric', 'relaxFrameAncestorsPolicies'] as $gone) {
        check(!method_exists(Module::class, $gone), "Module::$gone() is back; call the owning class");
    }

    $csp = EmbedFramingListener::relaxFrameAncestorsPolicies([
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
        EmbedFramingListener::relaxFrameAncestorsPolicies([]) === ['frame-ancestors *'],
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

    // H5: twenty blocks declare their whole shell in the registry and
    // render through `_generic`; `on-this-day`, which does more than declare,
    // keeps its own template. Both halves are asserted, because a block with
    // NEITHER renders nothing and a block with BOTH renders the wrong one.
    //
    // The keys are checked too, against what the partials actually read: a
    // key one level off is not an error anywhere, it is just never read.
    // Periodicals Overview shipped for releases with `blockCss` beside
    // `assets` instead of inside it, and so without its stylesheet.
    $shellKeys = [   // view/common/iwac-block-shell.phtml
        'assets', 'blockClass', 'heading', 'headingLevel', 'loading', 'loadingClass',
        'prerendered', 'append', 'noscript', 'data', 'siteBase',
    ];
    $assetKeys = ['blockCss', 'needs', 'bundle'];   // view/common/iwac-assets.phtml
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
            check(BlockRegistry::partialFor($slug) === 'common/block-layout/_generic',
                "$slug: has a shell but does not route to _generic");
            foreach (array_keys($row['shell']) as $key) {
                check(in_array($key, $shellKeys, true),
                    "$slug: shell key '$key' is read by nothing (iwac-block-shell does not know it)");
            }
            $assets = $row['shell']['assets'] ?? [];
            foreach (array_keys($assets) as $key) {
                check(in_array($key, $assetKeys, true),
                    "$slug: assets key '$key' is read by nothing (iwac-assets does not know it)");
            }
            foreach (array_keys($assets['needs'] ?? []) as $flag) {
                check(in_array($flag, AssetPlan::FLAGS, true),
                    "$slug: needs flag '$flag' is not in AssetPlan::FLAGS");
            }
            foreach ((array) ($assets['blockCss'] ?? []) as $sheet) {
                check(is_readable($root . '/asset/css/blocks/' . $sheet . '.css'),
                    "$slug: blockCss '$sheet' has no asset/css/blocks/$sheet.css");
                check(is_readable($root . '/asset/css/blocks/' . $sheet . '.min.css'),
                    "$slug: blockCss '$sheet' has no committed asset/css/blocks/$sheet.min.css");
            }
            // Every rendering path must accept the declaration: an unknown
            // flag or bundle throws at render time, on the live page.
            try {
                AssetPlan::bundles($assets['needs'] ?? [], $assets['bundle'] ?? null);
                check(true, "$slug: asset plan accepted");
            } catch (\RuntimeException $e) {
                check(false, "$slug: asset plan refused: " . $e->getMessage());
            }
        } else {
            $ownTemplate++;
            check(is_readable($tpl), "$slug: no registry shell and no $slug.phtml");
            check(BlockRegistry::partialFor($slug) === 'common/block-layout/' . $slug,
                "$slug: has no shell but does not route to its own template");
        }
    }
    check($shellRows === 20, "expected 20 generic blocks, found $shellRows");
    check($ownTemplate === 1, "expected 1 block with its own template, found $ownTemplate");
    check(is_readable($root . '/view/common/block-layout/_generic.phtml'),
        '_generic.phtml is missing — twenty blocks render through it');
    // The periodicals sheet, specifically: the row that lost it.
    check(
        (BlockRegistry::get('periodicals-overview')['shell']['assets']['blockCss'] ?? null) === 'periodicals-overview',
        'periodicals-overview no longer declares its stylesheet inside `assets`'
    );
    // partialFor() builds a view path from a slug that arrives in a URL on
    // the embed route, so it must answer only for registered slugs.
    foreach (['', 'not-a-block', '../config/database.ini', 'collection-overview/../x', '_generic'] as $stranger) {
        try {
            BlockRegistry::partialFor($stranger);
            check(false, "partialFor() built a partial path for '$stranger'");
        } catch (\InvalidArgumentException $e) {
            check(true, 'unknown slug refused');
        }
    }
    check(!method_exists(BlockRegistry::class, 'slugForClass'), 'BlockRegistry::slugForClass() is back with no caller');

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
        in_array('stopping', DataController::ACTIVE_STATUSES, true),
        'a stopping sync is not treated as active'
    );
    // The recovery decision. Only a sync that is running, that the admin
    // asked to recover AND that no worker holds the lock for may be replaced;
    // every other running case is refused.
    foreach ([
        [false, false, false, DataController::DECISION_DISPATCH],
        [false, true,  true,  DataController::DECISION_DISPATCH],
        [true,  false, true,  DataController::DECISION_REFUSE],
        [true,  true,  false, DataController::DECISION_REFUSE],
        [true,  false, false, DataController::DECISION_REFUSE],
        [true,  true,  true,  DataController::DECISION_RECOVER],
    ] as [$running, $asked, $lockFree, $expected]) {
        check(
            DataController::syncDecision($running, $asked, $lockFree) === $expected,
            sprintf('sync decision (running=%d, recover=%d, lock free=%d) is not %s', $running, $asked, $lockFree, $expected)
        );
    }

    // The release pointer: only the immutable tag shape the workflow writes
    // survives, because the result is spliced into the download URL.
    check(
        SyncData::tagFromPointer('{"tag":"data-build-123-1"}') === 'data-build-123-1',
        'a well-formed release pointer was rejected'
    );
    foreach ([
        '',
        'not json',
        '[]',
        '"data-build-1-1"',
        '{"tag":5}',
        '{"tag":""}',
        '{"tag":"data"}',
        '{"tag":"data-build-1-1/../../evil"}',
        '{"tag":"data-build-1-1\\n"}',
        '{"other":"data-build-1-1"}',
    ] as $pointer) {
        try {
            SyncData::tagFromPointer($pointer);
            check(false, 'release pointer accepted: ' . $pointer);
        } catch (\RuntimeException $e) {
            check(true, 'malformed release pointer refused');
        }
    }

    // SyncData::perform() against real ZIP fixtures. Kept in its own file:
    // it needs a dozen fakes and a temp-directory lifecycle, which would
    // dwarf the pure contracts above.
    require __DIR__ . '/sync_data_archive.php';
    check(AssetPlan::bundles([], null) === ['shared-core'], 'minimal asset plan gained unnecessary libraries');
    check(AssetPlan::bundles(['table' => true, 'pagination' => true, 'maplibre' => true], null)
        === ['shared-core', 'shared-ui', 'shared-map'], 'asset plan lost dependency ordering or deduplication');
    check(AssetPlan::bundles(['echarts' => false, 'wordcloud' => true, 'd3' => true], null)
        === ['shared-core', 'shared-d3'], 'the CDN-only flags changed which bundles load');
    try {
        AssetPlan::bundles([], 'unknown-bundle');
        check(false, 'unknown bundle was accepted');
    } catch (\RuntimeException $e) {
        check(true, 'unknown bundle rejected');
    }
    // An unknown flag is a typo or a removed flag, and either way the block
    // would load without what it asked for. `renderers` is the removed one.
    foreach (['renderers', 'mapLibre', 'chartoptions', 0] as $flag) {
        try {
            AssetPlan::bundles([$flag => true], null);
            check(false, "unknown needs flag '$flag' was accepted");
        } catch (\RuntimeException $e) {
            check(true, 'unknown needs flag rejected');
        }
    }
    // scripts/check-blocks.js reads FLAGS out of the source, so its literal
    // shape is part of the contract: one flat list of single-quoted names.
    $assetPlanSource = (string) file_get_contents($root . '/src/Site/AssetPlan.php');
    check(
        preg_match("~public const FLAGS = \[\s*((?:'[A-Za-z0-9]+',\s*)+)\];~", $assetPlanSource, $flagsMatch) === 1
            && preg_match_all("~'([A-Za-z0-9]+)'~", $flagsMatch[1], $flagNames) === count(AssetPlan::FLAGS)
            && $flagNames[1] === AssetPlan::FLAGS,
        'AssetPlan::FLAGS is no longer a flat list of single-quoted strings'
    );

    if ($failures) {
        fwrite(STDERR, "\nPHP behavioral tests failed:\n");
        foreach ($failures as $failure) {
            fwrite(STDERR, '  - ' . $failure . "\n");
        }
        exit(1);
    }

    echo sprintf("PHP behavioral tests passed: %d checks\n", $checks);
}
