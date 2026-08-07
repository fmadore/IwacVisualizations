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
    /**
     * The three rating models, as the camelCase stem of their `iwac:`
     * properties. These are the July–August 2026 generation: the earlier
     * `gemini` / `chatgpt` / `mistral` properties named a *vendor slot*
     * rather than a model and recorded nothing about which model ran.
     *
     * The matching Hugging Face column prefixes — what the precomputed
     * blocks key on — are the snake_case forms: `gpt_5_6_luna`,
     * `mistral_small_2603`, `deepseek_v4_flash_0731`.
     */
    const MODELS = ['gpt56Luna', 'mistralSmall2603', 'deepseekV4Flash0731'];

    /**
     * Presentation chrome for the three rating models: the precise model
     * name (release / parameter detail included — readers of a research
     * instrument want to know exactly which model produced a rating), the
     * organisation, a short form for chart legends, and the logo filename
     * under `asset/img/ai-logos/`.
     *
     * Lives here rather than in the article partial so the sentiment cards
     * and the radar legend cannot drift apart on a model rename. Not
     * `@translate`-marked: these are proper nouns.
     *
     * NOTE: the JS side carries its own copy for the Sentiment Atlas block
     * (`asset/js/charts/sentiment-atlas.js` MODELS and the
     * `sentiment.rated_*` strings in `sentiment-atlas/i18n.js`) — PHP
     * constants aren't reachable from a precomputed-JSON block. On a model
     * rename, update this constant AND those two files together.
     */
    const MODEL_INFO = [
        'gpt56Luna' => [
            'name'  => 'GPT-5.6 Luna',
            'org'   => 'OpenAI',
            'short' => 'GPT-5.6 Luna',
            'logo'  => 'ChatGPT_logo.svg',
        ],
        'mistralSmall2603' => [
            'name'  => 'Mistral Small 4',
            'org'   => 'Mistral AI',
            'short' => 'Mistral Small 4',
            'logo'  => 'Mistral_AI_logo.svg',
        ],
        'deepseekV4Flash0731' => [
            'name'  => 'DeepSeek V4 Flash',
            'org'   => 'DeepSeek',
            'short' => 'DeepSeek V4 Flash',
            'logo'  => 'DeepSeek_logo.svg',
        ],
    ];

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
            // One lookup per property, reused for both the id and the display
            // title. Reading them separately (linkedItemId + linkedItemLabel)
            // ran `$item->value()` twice for polarity and twice for
            // centrality — 4 redundant property reads per model, 12 per
            // article, all resolving the same linked resource.
            $polResource = self::firstValueResource($item, "iwac:{$model}Polarite");
            $cenResource = self::firstValueResource($item, "iwac:{$model}Centralite");
            $subItemId   = self::linkedItemId($item, "iwac:{$model}SubjectiviteScore");

            $polLabel = Module::getPolariteLabel($polResource ? $polResource->id() : null);
            $cenLabel = Module::getCentraliteLabel($cenResource ? $cenResource->id() : null);
            $subInfo  = Module::getSubjectiviteInfo($subItemId);

            $out[$model] = [
                // English source labels — feed into $view->translate()
                // for the public display in the article partial's
                // sentiment panel, and (for polarity / centrality) into
                // the *_numeric lookups below.
                'polarite'              => $polLabel,
                'centralite'            => $cenLabel,
                'subjectivite_score'    => $subInfo['score']  ?? null,
                'subjectivite_label'    => $subInfo['label']  ?? null,

                // Raw French labels from the authority vocabulary. The
                // CSS colour palette (defined in iwac-core.css under
                // --iwac-vis-sent-* / --iwac-vis-cent-*) is keyed on
                // these, so we need them even when the locale is en.
                'polarite_fr'           => $polResource ? (string) $polResource->displayTitle() : '',
                'centralite_fr'         => $cenResource ? (string) $cenResource->displayTitle() : '',

                // Ordinal position on each 1-5 scale: which stop the
                // model's marker sits on, and the input to the panel's
                // agree / nearly-agree / disagree verdict.
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
