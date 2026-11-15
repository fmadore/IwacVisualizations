<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/**
 * What the Collection Introduction says — the one source of its words.
 *
 * The block renders the same chapters twice: as a server-rendered reading
 * (title, lede, one heading and one or two sentences per chapter, readable
 * with scripting off and in print), and as the animated Svelte version that
 * replaces it once the bundle runs and `collection-overview.json` has
 * arrived, which adds a display numeral and one figure per chapter. Both
 * read this table, so the text is written and translated once, through
 * `language/fr.po`, and the JavaScript carries only drawings and numbers.
 *
 * The sentences never state a figure: the numbers change with every data
 * release and live in the figures, which the client fills from the JSON.
 * A sentence must therefore read the same with or without them, and say
 * nothing the next data release could make false (no "six countries", no
 * "since 1961"). The two strings that do carry a value, `asOf` and
 * `decade`, carry it as a `{placeholder}` the client substitutes, so the
 * word order stays the translator's.
 *
 * Every translatable literal sits on its own line ending in `// @translate`,
 * which is what `scripts/extract-pot.js` reads.
 */
final class CollectionIntroText
{
    const TEXT = [
        'title' => 'The Islam West Africa Collection', // @translate
        'lede' => 'A digital archive of the press, periodicals, recordings and documents in which Islam and Muslims in West Africa are written about and debated, built at the Leibniz-Zentrum Moderner Orient (ZMO) in Berlin. The chapters below say what it holds, where and when it comes from, and what it speaks of.', // @translate
    ];

    /**
     * The chapters, in reading order. `id` names the figure the Svelte
     * component draws for it (asset/js/svelte/collection-intro/).
     *
     * An `optional` chapter is one the drawn introduction leaves out
     * entirely — heading, words and figure — when the data has nothing for
     * it, rather than keeping its words without a figure as the others do.
     * The bibliography chapter is one: its section of the data file arrived
     * after the block, and a data release from before then must still read
     * as a complete introduction. That is also why it comes last (the
     * chapter numbers of the others never move) and why the lede does not
     * count the chapters. The server's reading always carries it: its words
     * are true whatever the data holds.
     */
    const CHAPTERS = [
        [
            'id' => 'what',
            'heading' => 'What it holds', // @translate
            'text' => 'Newspaper articles sit beside Islamic periodicals, audiovisual recordings, archival documents, photographs and a bibliography of scholarly references. An index of people, organisations, places, subjects and events links them together.', // @translate
        ],
        [
            'id' => 'where',
            'heading' => 'Where it comes from', // @translate
            'text' => 'Each item is filed under the country of the newspaper, institution or channel it comes from. The bibliography of scholarly references is not counted by country.', // @translate
        ],
        [
            'id' => 'when',
            'heading' => 'The years it covers', // @translate
            'text' => 'Each dated item is counted in its year of publication. The bars show what the collection holds, not how much was published at the time.', // @translate
        ],
        [
            'id' => 'voices',
            'heading' => 'Languages and subjects', // @translate
            'text' => 'Most items are in French, the language of most of the region’s press. The index tags each item with the people, organisations, places, subjects and events it concerns; the lists give those tagged most often.', // @translate
        ],
        [
            'id' => 'references',
            'optional' => true,
            'heading' => 'The scholarship it gathers', // @translate
            'text' => 'Beside its sources, the collection is a bibliography of the scholarship on Islam and Muslims in West Africa: books, journal articles, chapters, theses and reports, each catalogued with its authors, date and type. The bars count them by decade of publication: what the bibliography holds, not all that has been written.', // @translate
        ],
    ];

    /**
     * Words inside the figures: the numerals' labels, the figure captions,
     * the item types. Language names and index types are not here: the
     * module already translates them once, in iwac-i18n.js (`lang_*`,
     * `entity_type_*`), for every block that shows them.
     */
    const LABELS = [
        'items'       => 'items', // @translate
        'indexEntries' => 'index entries', // @translate
        'words'       => 'words of full text', // @translate
        'byType'      => 'Items by type', // @translate
        'countries'   => 'countries', // @translate
        'byCountry'   => 'Items by country', // @translate
        'span'        => 'first and last year of publication', // @translate
        'newspapers'  => 'newspapers and periodicals', // @translate
        'perYear'     => 'Items per year', // @translate
        'peak'        => 'Peak year', // @translate
        'perDecade'   => 'Totals by decade', // @translate
        'decade'      => '{decade}s', // @translate
        'languages'   => 'languages', // @translate
        'byLanguage'  => 'Items by language', // @translate
        'otherLanguages' => 'Other languages', // @translate
        'entities'    => 'Most often indexed', // @translate
        'references'  => 'scholarly references', // @translate
        'authors'     => 'authors', // @translate
        'refsByDecade' => 'References by decade of publication', // @translate
        'refsByType'  => 'References by type', // @translate
        'otherTypes'  => 'Other types', // @translate
        'before'      => 'Before {year}', // @translate
        'undated'     => 'Undated: {count}', // @translate
        'asOf'        => 'Figures from the collection’s data as of {date}.', // @translate
        'type.article'     => 'Newspaper articles', // @translate
        'type.publication' => 'Islamic periodicals', // @translate
        'type.audiovisual' => 'Audiovisual recordings', // @translate
        'type.document'    => 'Archival documents', // @translate
        'type.reference'   => 'Scholarly references', // @translate
        'type.image'       => 'Photographs', // @translate
    ];

    /** Heading levels an editor may give the block title; chapters go one below. */
    const HEADING_LEVELS = ['h2', 'h3', 'h4'];

    /**
     * h2: the block is meant to open a homepage or an About page, where it is
     * a section of its own rather than a figure inside one.
     */
    const DEFAULT_HEADING_LEVEL = 'h2';

    public static function headingLevel(?string $level): string
    {
        return in_array($level, self::HEADING_LEVELS, true) ? $level : self::DEFAULT_HEADING_LEVEL;
    }

    /**
     * Every string passed through `$translate`, in the shape the template
     * renders and the Svelte component receives as JSON.
     *
     * @param callable(string): string $translate
     */
    public static function content(string $headingLevel, callable $translate): array
    {
        $level = self::headingLevel($headingLevel);
        $chapters = [];
        foreach (self::CHAPTERS as $chapter) {
            $chapters[] = [
                'id' => $chapter['id'],
                'optional' => !empty($chapter['optional']),
                'heading' => $translate($chapter['heading']),
                'text' => $translate($chapter['text']),
            ];
        }
        $labels = [];
        foreach (self::LABELS as $key => $label) {
            $labels[$key] = $translate($label);
        }
        return [
            'headingLevel' => $level,
            'chapterHeadingLevel' => 'h' . min(6, (int) substr($level, 1) + 1),
            'title' => $translate(self::TEXT['title']),
            'lede' => $translate(self::TEXT['lede']),
            'chapters' => $chapters,
            'labels' => $labels,
        ];
    }
}
