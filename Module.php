<?php
namespace IwacVisualizations;

use Laminas\EventManager\Event;
use Laminas\EventManager\SharedEventManagerInterface;
use Laminas\Mvc\MvcEvent;
use Omeka\Module\AbstractModule;

/**
 * IWAC Visualizations module.
 *
 * Asset loading: a block template declares WHAT it needs through
 * `view/common/iwac-assets.phtml` (stylesheets, CDN libraries, shared JS
 * modules, panels, orchestrator) and that partial emits them — templates
 * never call $this->headLink / headScript themselves. We deliberately do
 * NOT attach a controller listener that blanket-loads ECharts/MapLibre on
 * every Item and ItemSet view — doing so cost ~600 KB of unused JavaScript
 * on every Article page, even when no Visualizations block was configured.
 * Per-block declaration keeps the cost contained to pages that actually
 * render a block, and the on-view lazy loader in that partial defers even
 * those until a block nears the viewport.
 *
 * Sentiment properties: the article dashboard renders its AI sentiment
 * panel from Omeka item metadata (iwac:<model><Axis>) rather than the
 * precomputed HF dataset. To keep the default item page clean we
 * attach a `rep.resource.display_values` listener that strips every
 * sentiment property from the default metadata table. This mirrors
 * the pattern of the standalone `IwacSentiment` module whose logic is
 * now rolled into this module (v0.11.0+). See
 * `src/Site/ResourcePageBlockLayout/SentimentExtractor.php` for the
 * mapping from the controlled-vocabulary item IDs to display labels.
 *
 * If you add a new block: register it in `IwacVisualizations\Site\BlockRegistry`
 * (slug, label, description), add a `BlockLayout` subclass declaring that
 * slug, wire the invokable in config/module.config.php, and model the
 * template on `view/common/block-layout/press-bylines.phtml` — a call to
 * `common/iwac-block-shell` with an `assets` array. `npm run lint:blocks`
 * checks those four sites still agree.
 */
class Module extends AbstractModule
{
    /**
     * Every annotator family in the `iwac:` sentiment vocabulary, as the
     * camelCase stem its six properties share.
     *
     * Deliberately wider than the models the article panel renders
     * (`SentimentExtractor::MODELS`): the vocabulary also holds the
     * January–February 2026 generation-1 slots and a retired DeepSeek
     * preview that still carries ~11.5k real annotations. Every one of
     * them must stay out of the default metadata table — listing only the
     * models currently on display would dump 20-odd raw rating rows back
     * onto every article page the moment the panel's model set changes.
     *
     * This list must gain a stem BEFORE that model's first annotation
     * lands upstream, not after. A stem missing here is not a quiet
     * degradation: the six raw rating rows appear on every article page
     * the run has reached, justification prose included.
     */
    const SENTIMENT_MODEL_STEMS = [
        // Generation 1 — vendor slots, read-only, being retired upstream.
        'gemini', 'chatgpt', 'mistral',
        // Generation 2 — keyed by model. The five the panel renders,
        // plus the families whose properties exist but hold no (or
        // superseded) values.
        'gpt56Luna', 'mistralSmall2603', 'deepseekV4Flash0731', 'gemma431bIt',
        'qwen3827b',
        'deepseekV4Flash', 'gemini35FlashLite', 'gemini36Flash',
        'qwen35A3b', 'qwen35A10b',
    ];

    /** The six property suffixes each annotator family carries. */
    const SENTIMENT_AXIS_SUFFIXES = [
        'Centralite',
        'CentraliteJustification',
        'Polarite',
        'PolariteJustification',
        'SubjectiviteScore',
        'SubjectiviteJustification',
    ];

    /**
     * Controlled-vocabulary item IDs → English source labels for the
     * three sentiment axes. Keys come from islam.zmo.de's `Sentiment`
     * controlled vocabulary (item IDs 78031..78052). The English
     * source labels are run through `$view->translate()` so the public
     * display respects the Omeka locale.
     *
     * Ported verbatim from `IwacSentiment\Module` so existing
     * translation catalogues (language/fr.po) keep working after the
     * merge. When new enum values are added to the authority list,
     * update these three maps together.
     */
    const CENTRALITE_ITEMS = [
        78048 => 'Very central',
        78049 => 'Central',
        78050 => 'Secondary',
        78051 => 'Marginal',
        78052 => 'Not addressed',
    ];
    const POLARITE_ITEMS = [
        78031 => 'Very positive',
        78038 => 'Positive',
        78039 => 'Neutral',
        78040 => 'Negative',
        78041 => 'Very negative',
        78042 => 'Not applicable',
    ];
    const SUBJECTIVITE_ITEMS = [
        78043 => ['score' => 1, 'label' => 'Very objective'],
        78044 => ['score' => 2, 'label' => 'Rather objective'],
        78045 => ['score' => 3, 'label' => 'Mixed'],
        78046 => ['score' => 4, 'label' => 'Rather subjective'],
        78047 => ['score' => 5, 'label' => 'Very subjective'],
    ];

    /**
     * Ordinal position on each 1-5 scale (higher = more intense
     * positive / more central / more subjective). "Not applicable"
     * polarity collapses to 0, which is deliberately OFF the scale: the
     * article sentiment panel renders it as an empty track with the word
     * shown in muted type, and excludes it from the agreement verdict,
     * so an absent rating never reads as a rating at the negative end.
     */
    const CENTRALITE_VALUES = [
        'Very central' => 5,
        'Central'      => 4,
        'Secondary'    => 3,
        'Marginal'     => 2,
        'Not addressed'=> 1,
    ];
    const POLARITE_VALUES = [
        'Very positive' => 5,
        'Positive'      => 4,
        'Neutral'       => 3,
        'Negative'      => 2,
        'Very negative' => 1,
        'Not applicable'=> 0,
    ];

    public function getConfig()
    {
        return include __DIR__ . '/config/module.config.php';
    }

    /**
     * Grant public (unauthenticated and every role) access to the embed
     * controller. Omeka denies access to module controllers by default,
     * so the standalone iframe endpoint needs an explicit allow or it
     * would 403 for anonymous site visitors.
     */
    public function onBootstrap(MvcEvent $event): void
    {
        parent::onBootstrap($event);
        $acl = $this->getServiceLocator()->get('Omeka\Acl');
        // Use the registered controller service name (what Omeka adds as the
        // ACL resource), NOT the class FQCN — passing the FQCN throws
        // "Resource '...EmbedController' not found" and 500s the whole site.
        $acl->allow(null, ['IwacVisualizations\Controller\Site\Embed']);
        // Admin data-sync page (issue #7): restricted to administrators. The
        // resource name must match config `navigation.resource` and the
        // controller service name, same service-name rule as above.
        $acl->allow(
            ['global_admin', 'site_admin'],
            ['IwacVisualizations\Controller\Admin\Data']
        );

        // Allow the embed widget to be framed cross-origin (slides, project
        // sites, blog posts, …). On the /iwac-embed routes only, swap the
        // site's X-Frame-Options for a permissive CSP frame-ancestors:
        // X-Frame-Options only understands DENY / SAMEORIGIN — it cannot
        // allowlist origins — so a SAMEORIGIN hardening default (common in
        // nginx) renders the embed iframe blank on every other origin.
        // Modern browsers honour CSP frame-ancestors over X-Frame-Options.
        // See relaxEmbedFraming(). Attached on the *application* event
        // manager (not the shared one) because MvcEvent::FINISH is an
        // application lifecycle event.
        $event->getApplication()->getEventManager()->attach(
            MvcEvent::EVENT_FINISH,
            [$this, 'relaxEmbedFraming'],
            100
        );
    }

    /**
     * Replace X-Frame-Options with a permissive `Content-Security-Policy:
     * frame-ancestors *` on the /iwac-embed routes, so the public,
     * read-only embed can be framed on any origin.
     *
     * Scoped by matched route name prefix `site/iwac-embed`, so normal site
     * pages keep whatever framing policy the site/reverse proxy sets.
     *
     * Effective only for the header set by Omeka/PHP. If the reverse proxy
     * (nginx) adds `X-Frame-Options ... always`, that overrides PHP and must
     * be relaxed for the /iwac-embed path at the proxy too — but this CSP is
     * then already in place, so only the X-Frame-Options removal is left to
     * do there.
     */
    public function relaxEmbedFraming(MvcEvent $event): void
    {
        $match = $event->getRouteMatch();
        if (!$match || strpos((string) $match->getMatchedRouteName(), 'site/iwac-embed') !== 0) {
            return;
        }
        $response = $event->getResponse();
        if (!$response instanceof \Laminas\Http\Response) {
            return;
        }
        $headers = $response->getHeaders();
        foreach (self::responseHeadersNamed($headers, 'X-Frame-Options') as $header) {
            $headers->removeHeader($header);
        }
        // Public read-only widget — any parent may frame it. Every enforced
        // CSP policy must allow the parent: multiple CSP headers are applied
        // as an intersection, so appending a permissive second header cannot
        // relax an existing `frame-ancestors 'self'`. Rewrite the directive
        // in each policy while preserving every unrelated directive.
        $cspHeaders = self::responseHeadersNamed($headers, 'Content-Security-Policy');
        $policies = [];
        foreach ($cspHeaders as $header) {
            $policies[] = $header->getFieldValue();
            $headers->removeHeader($header);
        }
        foreach (self::relaxFrameAncestorsPolicies($policies) as $policy) {
            $headers->addHeaderLine('Content-Security-Policy', $policy);
        }
    }

    /**
     * Return every response header with the requested field name.
     *
     * Laminas HTTP versions bundled with Omeka S 4.0 treat generic headers
     * such as Content-Security-Policy as single-value in Headers::get(), even
     * when the response contains the field more than once. Iterating the
     * container is the version-neutral way to reach and rewrite every enforced
     * policy (and every X-Frame-Options line).
     */
    private static function responseHeadersNamed($headers, string $fieldName): array
    {
        $matches = [];
        foreach ($headers as $header) {
            if (strcasecmp($header->getFieldName(), $fieldName) === 0) {
                $matches[] = $header;
            }
        }
        return $matches;
    }

    /**
     * Return CSP header values with every enforced policy allowing framing.
     * Kept pure so multiple-policy composition is covered without booting MVC.
     */
    public static function relaxFrameAncestorsPolicies(array $headerValues): array
    {
        if (!$headerValues) {
            return ['frame-ancestors *'];
        }
        return array_map([self::class, 'relaxFrameAncestorsPolicy'], $headerValues);
    }

    /** Rewrite frame-ancestors within one CSP header value. */
    private static function relaxFrameAncestorsPolicy(string $headerValue): string
    {
        // A field value may contain a comma-separated CSP policy list. A comma
        // followed by a directive name starts another policy; ordinary source
        // expressions do not use that shape.
        $policyValues = preg_split(
            '/\s*,\s*(?=[A-Za-z][A-Za-z0-9-]*\s)/',
            trim($headerValue)
        );
        $relaxed = [];
        foreach ($policyValues ?: [''] as $policyValue) {
            $directives = array_values(array_filter(
                array_map('trim', explode(';', $policyValue)),
                static function (string $directive): bool {
                    return $directive !== '';
                }
            ));
            $rewritten = [];
            $inserted = false;
            foreach ($directives as $directive) {
                if (preg_match('/^frame-ancestors(?:\s|$)/i', $directive)) {
                    if (!$inserted) {
                        $rewritten[] = 'frame-ancestors *';
                        $inserted = true;
                    }
                    continue;
                }
                $rewritten[] = $directive;
            }
            if (!$inserted) {
                $rewritten[] = 'frame-ancestors *';
            }
            $relaxed[] = implode('; ', $rewritten);
        }
        return implode(', ', $relaxed);
    }

    public function attachListeners(SharedEventManagerInterface $sharedEventManager): void
    {
        // Strip sentiment properties from the default metadata table on
        // every item representation. The article dashboard still reads
        // them via $item->value() — this listener only cleans up the
        // rendered property list the public theme iterates over.
        $sharedEventManager->attach(
            'Omeka\Api\Representation\ItemRepresentation',
            'rep.resource.display_values',
            [$this, 'filterSentimentValues']
        );
    }

    /**
     * Every `iwac:<model><Axis>` property term, one per model family ×
     * axis. Built rather than spelled out: the vocabulary has grown from
     * 18 to 66 sentiment properties across two annotation generations,
     * and a hand-maintained list is exactly what falls behind.
     *
     * @return string[]
     */
    public static function sentimentProperties(): array
    {
        $terms = [];
        foreach (self::SENTIMENT_MODEL_STEMS as $model) {
            foreach (self::SENTIMENT_AXIS_SUFFIXES as $axis) {
                $terms[] = "iwac:{$model}{$axis}";
            }
        }
        return $terms;
    }

    /**
     * Drop the sentiment properties from the `values` array passed to
     * the default resource-page metadata loop. Other modules / themes
     * that want to display them can still reach them via
     * `$item->value('iwac:gpt56LunaPolarite')` directly.
     */
    public function filterSentimentValues(Event $event): void
    {
        $values = $event->getParam('values');
        foreach (self::sentimentProperties() as $prop) {
            unset($values[$prop]);
        }
        $event->setParam('values', $values);
    }

    /**
     * Lookup helpers used by the article dashboard partial to resolve
     * controlled-vocabulary item IDs to English source labels. Kept
     * static so the partial can call `Module::getPolariteLabel()`
     * without having to thread the module instance through the view.
     */
    public static function getCentraliteLabel(?int $itemId): ?string
    {
        return $itemId ? (self::CENTRALITE_ITEMS[$itemId] ?? null) : null;
    }
    public static function getPolariteLabel(?int $itemId): ?string
    {
        return $itemId ? (self::POLARITE_ITEMS[$itemId] ?? null) : null;
    }
    public static function getSubjectiviteInfo(?int $itemId): ?array
    {
        return $itemId ? (self::SUBJECTIVITE_ITEMS[$itemId] ?? null) : null;
    }
    public static function getCentraliteNumeric(?string $label): int
    {
        return $label ? (self::CENTRALITE_VALUES[$label] ?? 0) : 0;
    }
    public static function getPolariteNumeric(?string $label): int
    {
        return $label ? (self::POLARITE_VALUES[$label] ?? 0) : 0;
    }
}
