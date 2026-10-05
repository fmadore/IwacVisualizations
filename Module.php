<?php
declare(strict_types=1);

namespace IwacVisualizations;

use IwacVisualizations\Mvc\EmbedFramingListener;
use Laminas\EventManager\Event;
use Laminas\EventManager\SharedEventManagerInterface;
use Laminas\Mvc\MvcEvent;
use Omeka\Module\AbstractModule;

// Module constants are evaluated before Laminas installs this module's autoloader.
require_once __DIR__ . '/src/Sentiment/ModelRegistry.php';

/**
 * IWAC Visualizations module.
 *
 * Asset loading: a block declares WHAT it needs — a stylesheet, `needs`
 * flags (`Site\AssetPlan::FLAGS`) and the name of its JS bundle in
 * `asset/js/bundles.json` — and `view/common/iwac-assets.phtml` turns that
 * into CDN libraries plus the ordered bundle list. Templates never call
 * $this->headLink / headScript themselves. We deliberately do
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
 * `src/Site/ResourcePageBlockLayout/SentimentExtractor.php` for how an
 * item's properties become the panel's rows, and `src/Sentiment/` for the
 * three enums that map controlled-vocabulary item ids to labels and to
 * their position on each scale.
 *
 * If you add a new block: register it in `IwacVisualizations\Site\BlockRegistry`
 * (slug, label, description, and a `shell` row — the `assets` array plus the
 * wrapper class and loading message — which renders through
 * `view/common/block-layout/_generic.phtml`), add a `BlockLayout` subclass
 * declaring that slug, wire the invokable in config/module.config.php, and
 * list the bundle in `asset/js/bundles.json`. Only a block that needs custom
 * markup gets its own `view/common/block-layout/<slug>.phtml` (and no
 * `shell`), as `on-this-day` does. `npm run lint:blocks` checks those sites
 * still agree.
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
    const SENTIMENT_MODEL_STEMS = \IwacVisualizations\Sentiment\ModelRegistry::STEMS;

    /** The six property suffixes each annotator family carries. */
    const SENTIMENT_AXIS_SUFFIXES = [
        'Centralite',
        'CentraliteJustification',
        'Polarite',
        'PolariteJustification',
        'SubjectiviteScore',
        'SubjectiviteJustification',
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
        // Admin data-sync page (issue #7): GLOBAL admins only. The resource
        // name must match config `navigation.resource` and the controller
        // service name, same service-name rule as above.
        //
        // Not `site_admin`: the job this page dispatches replaces the whole
        // `files/iwac-visualizations/` tree, which every site on the
        // installation reads. A site admin's authority is over one site, and
        // this is not a per-site operation — it is a filesystem swap on
        // shared state, with a several-hundred-megabyte download in front of
        // it.
        $acl->allow(
            ['global_admin'],
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
     * Kept as a method on the module because `onBootstrap` attaches it and
     * `tests/integration/omeka_boot.php` calls it by name; the ~100 lines of
     * header parsing it used to carry now live in `EmbedFramingListener`
     * (Tier 8 / H4).
     */
    public function relaxEmbedFraming(MvcEvent $event): void
    {
        (new EmbedFramingListener())($event);
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
        // Built once per request: the listener below runs on EVERY item
        // representation's display values, and the list never changes
        // within a request.
        static $terms = null;
        if ($terms === null) {
            $terms = [];
            foreach (self::SENTIMENT_MODEL_STEMS as $model) {
                foreach (self::SENTIMENT_AXIS_SUFFIXES as $axis) {
                    $terms[] = "iwac:{$model}{$axis}";
                }
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
}
