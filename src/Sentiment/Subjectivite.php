<?php
declare(strict_types=1);

namespace IwacVisualizations\Sentiment;

/**
 * The `Subjectivite` axis — how much of the article is the reporter's own
 * judgement rather than reported fact.
 *
 * Same shape and same reasoning as `Polarite`; see that file. The one
 * difference is that this axis's score was already carried alongside the
 * label in the old array (`['score' => 3, 'label' => 'Mixed']`), so
 * `Module::getSubjectiviteInfo()` still returns exactly that shape — see
 * `info()` below — and the article partial did not have to change.
 */
enum Subjectivite: int
{
    case VeryObjective   = 78043;
    case RatherObjective = 78044;
    case Mixed           = 78045;
    case RatherSubjective = 78046;
    case VerySubjective  = 78047;

    /** English source label; the view runs it through `translate()`. */
    public function label(): string
    {
        return match ($this) {
            self::VeryObjective    => 'Very objective',    // @translate
            self::RatherObjective  => 'Rather objective',  // @translate
            self::Mixed            => 'Mixed',             // @translate
            self::RatherSubjective => 'Rather subjective', // @translate
            self::VerySubjective   => 'Very subjective',   // @translate
        };
    }

    /** Position on the 1-5 scale, higher being more subjective. */
    public function ordinal(): int
    {
        return match ($this) {
            self::VeryObjective    => 1,
            self::RatherObjective  => 2,
            self::Mixed            => 3,
            self::RatherSubjective => 4,
            self::VerySubjective   => 5,
        };
    }

    /**
     * The `['score' => int, 'label' => string]` shape the article partial
     * and `SentimentExtractor` have always received.
     *
     * @return array{score: int, label: string}
     */
    public function info(): array
    {
        return ['score' => $this->ordinal(), 'label' => $this->label()];
    }

    /** The case for a controlled-vocabulary item id, or null. */
    public static function fromItemId(?int $itemId): ?self
    {
        return $itemId ? self::tryFrom($itemId) : null;
    }
}
