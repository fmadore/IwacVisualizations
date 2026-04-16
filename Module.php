<?php
namespace IwacVisualizations;

use Laminas\EventManager\Event;
use Laminas\EventManager\SharedEventManagerInterface;
use Omeka\Module\AbstractModule;

/**
 * IWAC Visualizations module.
 *
 * Asset loading: every block partial in this module enqueues its own
 * stylesheet, CDN libraries, and JS dependencies via $this->headLink /
 * headScript. We deliberately do NOT attach a controller listener that
 * blanket-loads ECharts/MapLibre on every Item and ItemSet view —
 * doing so cost ~600 KB of unused JavaScript on every Article page,
 * even when no Visualizations block was configured. Per-partial
 * loading keeps the cost contained to pages that actually render a
 * block.
 *
 * Sentiment properties: the article dashboard renders its AI sentiment
 * panel from Omeka item metadata (iwac:<model><Axis>) rather than the
 * precomputed HF dataset. To keep the default item page clean we
 * attach a `rep.resource.display_values` listener that strips the 18
 * sentiment properties from the default metadata table. This mirrors
 * the pattern of the standalone `IwacSentiment` module whose logic is
 * now rolled into this module (v0.11.0+). See
 * `src/Site/ResourcePageBlockLayout/SentimentExtractor.php` for the
 * mapping from the controlled-vocabulary item IDs to display labels.
 *
 * If you add a new block, mirror the asset-enqueueing pattern from
 * `view/common/resource-page-block-layout/visualizations/person.phtml`
 * or `view/common/block-layout/collection-overview.phtml`.
 */
class Module extends AbstractModule
{
    /**
     * IWAC vocabulary properties holding the 3-model (Gemini / ChatGPT
     * / Mistral) sentiment ratings + free-text justifications. Hidden
     * from the default Omeka metadata table because the article
     * dashboard surfaces them in a dedicated panel with model logos,
     * polarity badges, centrality dots, and expandable rationales.
     */
    const SENTIMENT_PROPERTIES = [
        // Gemini
        'iwac:geminiCentralite',
        'iwac:geminiCentraliteJustification',
        'iwac:geminiPolarite',
        'iwac:geminiPolariteJustification',
        'iwac:geminiSubjectiviteScore',
        'iwac:geminiSubjectiviteJustification',
        // ChatGPT
        'iwac:chatgptCentralite',
        'iwac:chatgptCentraliteJustification',
        'iwac:chatgptPolarite',
        'iwac:chatgptPolariteJustification',
        'iwac:chatgptSubjectiviteScore',
        'iwac:chatgptSubjectiviteJustification',
        // Mistral
        'iwac:mistralCentralite',
        'iwac:mistralCentraliteJustification',
        'iwac:mistralPolarite',
        'iwac:mistralPolariteJustification',
        'iwac:mistralSubjectiviteScore',
        'iwac:mistralSubjectiviteJustification',
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
     * Ordinal values used by the radar chart (higher = more intense
     * positive / more central / more subjective). "Not applicable"
     * polarity collapses to 0 so it reads as a missing spoke rather
     * than a negative one on the radar.
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
     * Drop the 18 sentiment properties from the `values` array passed
     * to the default resource-page metadata loop. Other modules /
     * themes that want to display them can still reach them via
     * `$item->value('iwac:geminiPolarite')` directly.
     */
    public function filterSentimentValues(Event $event): void
    {
        $values = $event->getParam('values');
        foreach (self::SENTIMENT_PROPERTIES as $prop) {
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
