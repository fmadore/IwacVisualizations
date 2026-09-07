<?php
declare(strict_types=1);

namespace IwacVisualizations\Sentiment;

/**
 * The `Polarite` axis of the islam.zmo.de `Sentiment` controlled vocabulary.
 *
 * The case names are the vocabulary's; the backing values are the Omeka item
 * ids an article's `iwac:<model>Polarite` property points at. Two arrays in
 * Module.php used to hold this — one id → label, one label → ordinal — with
 * nothing but convention keeping their key sets aligned (Tier 8 / H4). An
 * enum makes the value set closed: a `match` over `$this` is exhaustive, so
 * adding a case without giving it a label or an ordinal is an error at the
 * point of the change rather than a silent `?? 0` at read time.
 *
 * The `// @translate` markers are what `scripts/extract-pot.js` reads. These
 * labels reach `translate()` only through a variable, so without the marker
 * the catalogue would never carry them. `extract-pot` scans `src/` as well
 * as `Module.php`, so moving them here kept every msgid.
 */
enum Polarite: int
{
    case VeryPositive  = 78031;
    case Positive      = 78038;
    case Neutral       = 78039;
    case Negative      = 78040;
    case VeryNegative  = 78041;
    case NotApplicable = 78042;

    /** English source label; the view runs it through `translate()`. */
    public function label(): string
    {
        return match ($this) {
            self::VeryPositive  => 'Very positive',  // @translate
            self::Positive      => 'Positive',       // @translate
            self::Neutral       => 'Neutral',        // @translate
            self::Negative      => 'Negative',       // @translate
            self::VeryNegative  => 'Very negative',  // @translate
            self::NotApplicable => 'Not applicable', // @translate
        };
    }

    /**
     * Position on the 1-5 scale, higher being more positive.
     *
     * `NotApplicable` is 0, deliberately OFF the scale: the article
     * sentiment panel renders it as an empty track with the word in muted
     * type and excludes it from the agreement verdict, so an absent rating
     * never reads as a rating at the negative end.
     */
    public function ordinal(): int
    {
        return match ($this) {
            self::VeryPositive  => 5,
            self::Positive      => 4,
            self::Neutral       => 3,
            self::Negative      => 2,
            self::VeryNegative  => 1,
            self::NotApplicable => 0,
        };
    }

    /** The case for a controlled-vocabulary item id, or null. */
    public static function fromItemId(?int $itemId): ?self
    {
        return $itemId ? self::tryFrom($itemId) : null;
    }

    /**
     * The ordinal for an English source label, 0 when unknown.
     *
     * The extractor resolves an id to a label first and only then asks for
     * the number, so the label is the key it has in hand.
     */
    public static function ordinalForLabel(?string $label): int
    {
        if ($label === null || $label === '') {
            return 0;
        }
        foreach (self::cases() as $case) {
            if ($case->label() === $label) {
                return $case->ordinal();
            }
        }
        return 0;
    }
}
