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
    abstract class AbstractJob {}
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
    use IwacVisualizations\Site\BlockRegistry;
    use IwacVisualizations\Site\ResourcePageBlockLayout\SentimentExtractor;
    use IwacVisualizations\Site\ResourcePageBlockLayout\Visualizations;
    use Laminas\EventManager\Event;
    use Laminas\View\Renderer\PhpRenderer;
    use Omeka\Api\Representation\AbstractResourceEntityRepresentation;

    $root = dirname(__DIR__, 2);
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

    check(
        in_array('stopping', \IwacVisualizations\Controller\Admin\DataController::ACTIVE_STATUSES, true),
        'a stopping sync is not treated as active'
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
