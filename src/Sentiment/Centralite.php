<?php
declare(strict_types=1);

namespace IwacVisualizations\Sentiment;

/**
 * The `Centralite` axis — how central the article's subject is to the topic
 * the annotator was asked about.
 *
 * Same shape and same reasoning as `Polarite`; see that file for why these
 * are enums and what the `// @translate` markers do. This scale has no
 * off-scale member: every case is a rating from 1 to 5.
 */
enum Centralite: int
{
    case VeryCentral  = 78048;
    case Central      = 78049;
    case Secondary    = 78050;
    case Marginal     = 78051;
    case NotAddressed = 78052;

    /** English source label; the view runs it through `translate()`. */
    public function label(): string
    {
        return match ($this) {
            self::VeryCentral  => 'Very central',  // @translate
            self::Central      => 'Central',       // @translate
            self::Secondary    => 'Secondary',     // @translate
            self::Marginal     => 'Marginal',      // @translate
            self::NotAddressed => 'Not addressed', // @translate
        };
    }

    /** Position on the 1-5 scale, higher being more central. */
    public function ordinal(): int
    {
        return match ($this) {
            self::VeryCentral  => 5,
            self::Central      => 4,
            self::Secondary    => 3,
            self::Marginal     => 2,
            self::NotAddressed => 1,
        };
    }

    /** The case for a controlled-vocabulary item id, or null. */
    public static function fromItemId(?int $itemId): ?self
    {
        return $itemId ? self::tryFrom($itemId) : null;
    }

    /** The ordinal for an English source label, 0 when unknown. */
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
