<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use IwacVisualizations\Module;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;

/**
 * Pull the multi-model AI sentiment data off an Omeka item.
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
     * The rating models, as the camelCase stem of their `iwac:`
     * properties. These are the July–August 2026 generation: the earlier
     * `gemini` / `chatgpt` / `mistral` properties named a *vendor slot*
     * rather than a model and recorded nothing about which model ran.
     *
     * The matching Hugging Face column prefixes — what the precomputed
     * blocks key on — are the snake_case forms: `gpt_5_6_luna`,
     * `mistral_small_2603`, `deepseek_v4_flash_0731`, `gemma_4_31b_it`.
     *
     * A model appears here as soon as its corpus pass STARTS, not when it
     * finishes. This class reads Omeka per item, so a partially-annotated
     * model simply has no lane on the articles it has not reached yet —
     * `fromItem` marks it unrated and the partial drops it. The
     * precomputed side behaves differently and lags: it reads Hugging
     * Face columns that only exist once the uploader's panel has been
     * taught the model, so expect a window in which the item page shows
     * four raters and the corpus-level blocks still show three.
     */
    const MODELS = [
        'gpt56Luna',
        'mistralSmall2603',
        'deepseekV4Flash0731',
        'gemma431bIt',
    ];

    /**
     * Presentation chrome for the rating models: the precise model
     * name (release / parameter detail included — readers of a research
     * instrument want to know exactly which model produced a rating), the
     * organisation, a short form for chart legends, and the logo filename
     * under `asset/img/ai-logos/`.
     *
     * Lives here rather than in the article partial so the sentiment cards
     * and the radar legend cannot drift apart on a model rename. Not
     * `@translate`-marked: these are proper nouns.
     *
     * NOTE: the precomputed blocks cannot reach a PHP constant, so the JS
     * side has its own display-name table in
     * `asset/js/charts/shared/panels-controls.js`
     * (`P.sentimentModelLabel`). That table is now the ONLY JS copy, and
     * it is a label lookup rather than a model list: the panels take
     * which models to show from their payload's own `models` field, so a
     * rater-panel change no longer has to be mirrored into JS at all —
     * only a display name for the new id, and even that degrades to a
     * readable fallback if it is missed.
     *
     * This class is different: it reads Omeka properties directly, so
     * MODELS here is a genuine list of which `iwac:` properties to look
     * at and does have to be updated on a rater-panel change.
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
        // The Google slot since 2026-08-14, replacing a Gemini 3.5 Flash
        // Lite entry that was declared upstream and never wrote a value.
        // Raster rather than SVG like the other three: the mark is a
        // gradient-filled glyph over a construction grid, and a hand-traced
        // approximation of someone's logo is worse than a 96px bitmap
        // rendered into an 18px slot.
        'gemma431bIt' => [
            'name'  => 'Gemma 4 31B',
            'org'   => 'Google DeepMind',
            'short' => 'Gemma 4 31B',
            'logo'  => 'Gemma_logo.png',
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
     * True if at least one model rated any axis. The article partial
     * uses this to elide the whole panel for unrated items rather than
     * showing a column of empty model lanes.
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
