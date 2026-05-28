<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use IwacVisualizations\Module;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;

/**
 * Pull 3-model AI sentiment data off an Omeka item.
 *
 * Reads the `iwac:<model><Axis>` vocabulary properties (linked-resource
 * values that point at items in the authority controlled vocabulary)
 * and resolves each to an English source label via the enum maps in
 * `IwacVisualizations\Module`. The return shape is consumed by
 * `view/common/resource-page-block-layout/visualizations/article.phtml`
 * and rendered into the article dashboard's sentiment panel.
 *
 * Logic forked from the (now-retired) standalone `IwacSentiment`
 * module so we read sentiment directly from item metadata instead of
 * the precomputed HF dataset — keeps the dashboard in sync with
 * editorial changes on islam.zmo.de without waiting for a regenerator
 * pass. Property-hiding is already handled by `Module::filterSentimentValues`.
 */
class SentimentExtractor
{
    const MODELS = ['gemini', 'chatgpt', 'mistral'];

    /**
     * Extract and return the `[$model => [...]]` sentiment bundle.
     *
     * Each model slice looks like:
     *   [
     *     'polarite'                    => 'Positive' | null,
     *     'polarite_fr'                 => 'Positif'   (raw French string from the vocabulary),
     *     'centralite'                  => 'Very central' | null,
     *     'centralite_fr'               => 'Très central',
     *     'subjectivite_score'          => 1..5 | null,
     *     'subjectivite_label'          => 'Rather objective' | null,
     *     'polarite_justification'      => 'free text' | '',
     *     'centralite_justification'    => 'free text' | '',
     *     'subjectivite_justification'  => 'free text' | '',
     *     'polarite_numeric'            => 0..5,
     *     'centralite_numeric'          => 0..5,
     *     'rated'                       => bool  (at least one axis populated),
     *   ]
     *
     * The `*_fr` keys carry the raw French category name from the
     * authority vocabulary so the JS / CSS side can still look up
     * colour tokens that are keyed on French ("Positif",
     * "Très central"), regardless of the active site locale.
     */
    public static function fromItem(AbstractResourceEntityRepresentation $item): array
    {
        $out = [];
        foreach (self::MODELS as $model) {
            $polItemId = self::linkedItemId($item, "iwac:{$model}Polarite");
            $cenItemId = self::linkedItemId($item, "iwac:{$model}Centralite");
            $subItemId = self::linkedItemId($item, "iwac:{$model}SubjectiviteScore");

            $polLabel = Module::getPolariteLabel($polItemId);
            $cenLabel = Module::getCentraliteLabel($cenItemId);
            $subInfo  = Module::getSubjectiviteInfo($subItemId);

            $out[$model] = [
                // English source labels — feed into $view->translate()
                // for the public display and into the CSS class name
                // builder (`iwac-vis-chip--polarity-positive`, etc.).
                'polarite'              => $polLabel,
                'centralite'            => $cenLabel,
                'subjectivite_score'    => $subInfo['score']  ?? null,
                'subjectivite_label'    => $subInfo['label']  ?? null,

                // Raw French labels from the authority vocabulary. The
                // CSS colour palette (defined in iwac-core.css under
                // --iwac-vis-sent-* / --iwac-vis-cent-*) is keyed on
                // these, so we need them even when the locale is en.
                'polarite_fr'           => self::linkedItemLabel($item, "iwac:{$model}Polarite"),
                'centralite_fr'         => self::linkedItemLabel($item, "iwac:{$model}Centralite"),

                // Numeric values feed the ECharts radar.
                'polarite_numeric'      => Module::getPolariteNumeric($polLabel),
                'centralite_numeric'    => Module::getCentraliteNumeric($cenLabel),

                // Free-text rationale written by each model per axis.
                'polarite_justification'     => self::literalValue($item, "iwac:{$model}PolariteJustification"),
                'centralite_justification'   => self::literalValue($item, "iwac:{$model}CentraliteJustification"),
                'subjectivite_justification' => self::literalValue($item, "iwac:{$model}SubjectiviteJustification"),

                'rated' => (bool) ($polLabel || $cenLabel || ($subInfo['score'] ?? null)),
            ];
        }
        return $out;
    }

    /**
     * True if at least one of the three models rated any axis.
     * The article partial uses this to elide the whole panel for
     * unrated items rather than showing three empty model cards.
     */
    public static function hasAny(array $bundle): bool
    {
        foreach ($bundle as $slice) {
            if (!empty($slice['rated'])) return true;
        }
        return false;
    }

    /**
     * Pull the Omeka item ID that a resource:item property points to.
     * Returns null when the property is empty or the first value is
     * a literal rather than a linked item.
     */
    private static function linkedItemId(AbstractResourceEntityRepresentation $item, string $property): ?int
    {
        $resource = self::firstValueResource($item, $property);
        return $resource ? $resource->id() : null;
    }

    /**
     * Pull the display title of the linked item — used to recover
     * raw French category labels ("Positif", "Très central") that we
     * key the colour palette on.
     */
    private static function linkedItemLabel(AbstractResourceEntityRepresentation $item, string $property): string
    {
        $resource = self::firstValueResource($item, $property);
        return $resource ? (string) $resource->displayTitle() : '';
    }

    /**
     * Literal text value from a property (used for the justifications).
     */
    private static function literalValue(AbstractResourceEntityRepresentation $item, string $property): string
    {
        $value = self::firstValue($item, $property);
        return $value ? (string) $value : '';
    }

    /**
     * The first value of a property, or null. Wraps the `value(...,
     * ['all' => true])` lookup with the shared try/catch — a property
     * may be absent on a given resource template, which throws; we
     * treat "not present" as "no value" rather than surfacing noise.
     */
    private static function firstValue(AbstractResourceEntityRepresentation $item, string $property)
    {
        try {
            $values = $item->value($property, ['all' => true]);
            if ($values && isset($values[0])) {
                return $values[0];
            }
        } catch (\Exception $e) {
            // Property not present on this resource template — skip silently.
        }
        return null;
    }

    /**
     * The linked resource behind a property's first value, or null when
     * the property is empty or the first value is a literal.
     */
    private static function firstValueResource(AbstractResourceEntityRepresentation $item, string $property)
    {
        $value = self::firstValue($item, $property);
        return $value ? $value->valueResource() : null;
    }
}
