<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

/**
 * What each Pipeline explainer preset says — the one source of its words.
 *
 * The block renders the same content twice: as a server-rendered reading
 * (an ordered list per route, readable with scripting off and in print), and
 * as the animated Svelte diagram that replaces it once the bundle runs. Both
 * read this table, so the text is written and translated once, through
 * `language/fr.po`, and the JavaScript carries only drawings.
 *
 * Each stage's `art` names a drawing in
 * `asset/js/svelte/pipeline-explainer/<Preset>Art.svelte`; the drawings are
 * decoration (`aria-hidden`), so a stage's `name`, `caption` and `note` must
 * say everything the drawing shows. The words inside the drawings are
 * illustrative sample text, and every preset says so in its `example` line.
 *
 * The captions follow the pipelines as their code stands, not as they are
 * sometimes summarised: LDA preprocessing in IWAC-Hugging-Face
 * (`lemmatize_update_hf.py`, `post-processing/lda_topic_modeling/`), OCR and
 * NER in iwac-ai-pipelines (`AI_ocr_extraction/`, `AI_ocr_correction/`,
 * `AI_NER/`, `AI_authority_curation/`, `AI_summary_issue/`). Change a caption when the pipeline
 * changes, not when the prose elsewhere does.
 *
 * Every translatable literal sits on its own line ending in `// @translate`,
 * which is what `scripts/extract-pot.js` reads.
 */
final class PipelinePresets
{
    const DEFAULT_PRESET = 'ocr';

    /** Preset id => the label the admin select shows. */
    const LABELS = [
        'topic-modelling'   => 'Topic modelling (LDA)', // @translate
        'ocr'               => 'OCR with AI', // @translate
        'entity-enrichment' => 'Entity extraction and metadata enrichment', // @translate
        'albani-sermons'    => 'Albani Zaria sermons: from recordings to figures', // @translate
        'issue-contents'    => 'Tables of contents for Islamic publications', // @translate
    ];

    const PRESETS = [
        'topic-modelling' => [
            'title' => 'How topic modelling finds themes in the articles', // @translate
            'lede' => 'IWAC trains a statistical topic model, Latent Dirichlet Allocation (LDA), on the text of its newspaper articles. The model is never told what the topics are: it finds groups of words that tend to appear in the same articles.', // @translate
            'routes' => [[
                'id' => 'lda',
                'stages' => [
                    [
                        'art' => 'articles',
                        'name' => 'Articles', // @translate
                        'caption' => 'The input is the OCR text of each French-language newspaper article.', // @translate
                        'note' => 'Islamic publications and scholarly references have models of their own.', // @translate
                    ],
                    [
                        'art' => 'prepare',
                        'name' => 'Text preparation', // @translate
                        'caption' => 'Words are reduced to their dictionary form, and very common words are removed.', // @translate
                        'note' => 'Place names and other terms that would dominate every topic are set aside; frequent word pairs such as al_azhar stay together.', // @translate
                    ],
                    [
                        'art' => 'counts',
                        'name' => 'Word counts', // @translate
                        'caption' => 'Each article becomes a count of the words it uses; word order is discarded.', // @translate
                        'note' => 'Words found in very few articles, or in a large share of them, are left out.', // @translate
                    ],
                    [
                        'art' => 'topics',
                        'name' => 'Topic discovery', // @translate
                        'caption' => 'LDA infers 30 topics, each a list of words weighted by how strongly they belong to it.', // @translate
                        'note' => 'A topic’s label is simply its most characteristic words.', // @translate
                    ],
                    [
                        'art' => 'mixtures',
                        'name' => 'Topic mixtures', // @translate
                        'caption' => 'Each article receives a share of several topics; IWAC keeps its main topic and its three strongest.', // @translate
                        'note' => 'The Topic Explorer follows each topic across years, countries and newspapers.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'Topics are patterns inferred from words that occur together, not subjects assigned by a cataloguer. They need interpretation: read the articles behind a topic before naming it, and remember that most articles combine several topics.', // @translate
            'example' => 'Illustrative example: the words and proportions in the drawings are invented to show the method, not taken from the IWAC model.', // @translate
        ],
        'ocr' => [
            'title' => 'How AI turns scanned pages into searchable text', // @translate
            'lede' => 'IWAC uses one of two routes, depending on what a document already has. New scans go to a multimodal model that reads the page image itself; noisy text from conventional OCR can be corrected instead. A document takes one route, not both.', // @translate
            'routes' => [
                [
                    'id' => 'extraction',
                    'title' => 'Direct extraction, the current workflow', // @translate
                    'stages' => [
                        [
                            'art' => 'scan',
                            'name' => 'Scanned page', // @translate
                            'caption' => 'The document’s PDF goes to a multimodal model: Gemini reads it page by page, Mistral Document AI in a single request.', // @translate
                        ],
                        [
                            'art' => 'order',
                            'name' => 'Reading order', // @translate
                            'caption' => 'The instructions set the order: main columns left to right and top to bottom, then headings, captions and sidebars.', // @translate
                            'note' => 'The model reads layout and text in one pass; the steps are drawn apart here.', // @translate
                        ],
                        [
                            'art' => 'transcribe',
                            'name' => 'Transcription', // @translate
                            'caption' => 'The model writes out the text, rejoining lines and words that the columns broke, and keeps the source wording.', // @translate
                        ],
                        [
                            'art' => 'assembled',
                            'name' => 'Assembled text', // @translate
                            'caption' => 'The pages are joined with page markers and, after a preview, saved to the record with the name of the model.', // @translate
                            'note' => 'The scan stays beside the text: an unusual layout can still come out in the wrong order.', // @translate
                        ],
                    ],
                ],
                [
                    'id' => 'correction',
                    'title' => 'Post-correction of noisy OCR', // @translate
                    'stages' => [
                        [
                            'art' => 'legacy',
                            'name' => 'Noisy OCR text', // @translate
                            'caption' => 'Text from conventional OCR, with its misread characters, broken words and encoding errors.', // @translate
                        ],
                        [
                            'art' => 'sections',
                            'name' => 'Sections', // @translate
                            'caption' => 'A very long text is cut into sections that the model can correct in one request.', // @translate
                            'note' => 'Context across a cut can be lost.', // @translate
                        ],
                        [
                            'art' => 'correct',
                            'name' => 'AI correction', // @translate
                            'caption' => 'A language model fixes recognition errors and restores accents, without translating or modernising the text.', // @translate
                        ],
                        [
                            'art' => 'corrected',
                            'name' => 'Corrected text', // @translate
                            'caption' => 'The corrected version becomes the searchable full text; the original OCR is kept for comparison.', // @translate
                            'note' => 'Historical names and spellings are kept as printed.', // @translate
                        ],
                    ],
                ],
            ],
            'caveat' => 'Fluent output is not proof of accuracy. A model can modernise an unusual spelling, guess a missing word or skip part of a page, and an error in fluent text is harder to spot than garbled characters. Check quotations and proper names against the scan.', // @translate
            'example' => 'Illustrative example: the page and its misreadings are invented to show the method.', // @translate
        ],
        'entity-enrichment' => [
            'title' => 'How names in articles become links to authority records', // @translate
            'lede' => 'An AI model reads each newspaper article and lists the persons, organisations, places and subjects it mentions. A name is only a mention until it is matched with IWAC’s authority files, which gather variant spellings under one record.', // @translate
            'routes' => [[
                'id' => 'ner',
                'stages' => [
                    [
                        'art' => 'mentions',
                        'name' => 'Extraction and normalisation', // @translate
                        'caption' => 'The model lists the names it finds, without titles such as El Hadj and with acronyms written out in full.', // @translate
                        'note' => 'Subjects are chosen from IWAC’s own vocabulary.', // @translate
                    ],
                    [
                        'art' => 'reconcile',
                        'name' => 'Reconciliation', // @translate
                        'caption' => 'Each name is compared with the authority records and their alternative forms: exact matches are accepted, close spellings only suggested.', // @translate
                        'note' => 'A name that fits several records is set aside rather than guessed.', // @translate
                    ],
                    [
                        'art' => 'review',
                        'name' => 'Review', // @translate
                        'caption' => 'A researcher checks ambiguous names, close spellings and unknown entities, and accepts, corrects or rejects each proposal.', // @translate
                        'note' => 'A name with no record waits for a new authority record, created after curation.', // @translate
                    ],
                    [
                        'art' => 'linked',
                        'name' => 'Linking', // @translate
                        'caption' => 'Confirmed matches are added to the article as links: places under Spatial coverage, everything else under Subject.', // @translate
                        'note' => 'Each link records the model that proposed it; an update only adds links, after a backup.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'A highlighted name is a mention, not yet a link. A model can miss a name or match it to the wrong record, and the renamings and splits of organisations need historical knowledge, so uncertain matches are reviewed and every update can be reversed.', // @translate
            'example' => 'Illustrative example: the name variants are those of a real person in the IWAC index; the sentence around them is invented.', // @translate
        ],
        // Follows the Albani Zaria sermons block's own method section
        // (asset/js/charts/albani-sermons/method.js) and the transcription
        // pipeline it reads (iwac-ai-pipelines `AI_audio_summary/`). When
        // the method section changes, this preset changes with it.
        'albani-sermons' => [
            'title' => 'How the Albani Zaria sermons become figures', // @translate
            'lede' => 'The Albani Zaria exhibition counts words, terms and names across the transcribed sermons and lessons of Shaykh Muhammad Auwal Albani Zaria. Every figure leads back to a passage, and every passage to its recording.', // @translate
            'routes' => [[
                'id' => 'sermons',
                'stages' => [
                    // In the order of the block's own sections, under their
                    // names, so the diagram doubles as a map of the page.
                    [
                        'art' => 'recording',
                        'name' => 'The recordings', // @translate
                        'caption' => 'Speech recognition writes each recording out word for word, in 20-minute segments, and estimates who is speaking. Recordings not yet transcribed, and passages in English, are left out.', // @translate
                        'note' => 'Both can be wrong, so every passage links back to the recording.', // @translate
                    ],
                    [
                        'art' => 'normalise',
                        'name' => 'Vocabulary', // @translate
                        'caption' => 'Spellings with and without the hooked letters (ɓ, ɗ, ƙ, ƴ) count as one word; the commonest words and the speaker’s fillers, such as wato, are left out.', // @translate
                        'note' => 'The stop words are those published by Bashir, Bichi and Adamu (2024); religious formulae are counted as whole phrases, and a simple rule tells Arabic passages from Hausa.', // @translate
                    ],
                    [
                        'art' => 'names',
                        'name' => 'People and places', // @translate
                        'caption' => 'A named-entity model proposed names once; only a list of names and spellings curated by hand is counted.', // @translate
                        'note' => 'A spelling with another meaning, such as shehu, is left out, so the counts are floors.', // @translate
                    ],
                    [
                        'art' => 'terms',
                        'name' => 'Youth and politics', // @translate
                        'caption' => 'Terms for youth and for politics are found in the text, with the words that occur unusually often near them and the places where the two themes meet.', // @translate
                        'note' => 'The word lists are a draft that a Hausa-speaking specialist will check.', // @translate
                    ],
                    [
                        'art' => 'figures',
                        'name' => 'Figures and passages', // @translate
                        'caption' => 'The counts become the page’s charts, its map and the words that set each recording apart; passages are quoted only from transcripts that are public.', // @translate
                        'note' => 'A count shows where to look; the passage and the recording are the evidence.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'The figures describe these recordings only: one preacher, the part of his teaching transcribed so far, and the errors the transcription contains. The word lists and translations are drafts awaiting a specialist’s review.', // @translate
            'example' => 'Illustrative example: the drawings show the method with words the exhibition’s method section cites; the passages are lines, not quotations.', // @translate
        ],
        // Follows iwac-ai-pipelines `AI_summary_issue/`: the page prompt
        // (summary_prompt_issue.md), the consolidation prompt
        // (consolidation_prompt_issue.md) and the updater
        // (03_update_omeka_toc.py), which writes `dcterms:tableOfContents`
        // with an `iwac:summaryModel` annotation.
        'issue-contents' => [
            'title' => 'How an issue of an Islamic magazine gets its table of contents', // @translate
            'lede' => 'Digitised Islamic magazines were first searchable only as whole issues. An AI model reads each issue page by page, follows every article across the pages it spans, and writes a table of contents that makes each article findable on its own.', // @translate
            'routes' => [[
                'id' => 'contents',
                'stages' => [
                    [
                        'art' => 'issue',
                        'name' => 'Issue', // @translate
                        'caption' => 'Each digitised issue is split into single pages, and each page goes to a vision model on its own: Gemini, Claude or Mistral OCR.', // @translate
                        'note' => 'The issue itself stays whole in the collection.', // @translate
                    ],
                    [
                        'art' => 'page',
                        'name' => 'Articles on each page', // @translate
                        'caption' => 'The model lists every article on the page: its title as printed, with its section in brackets, its authors and a short summary of what the page shows.', // @translate
                        'note' => 'Covers, advertisements and short notices are set aside; Arabic terms read correctly are kept.', // @translate
                    ],
                    [
                        'art' => 'continuation',
                        'name' => 'Continuations', // @translate
                        'caption' => 'Markers such as “suite page 7” or “à suivre” are noted, so the parts of an article printed apart can be found again.', // @translate
                        'note' => 'An article that ends on a later page is listed there too, under its title or as a continuation.', // @translate
                    ],
                    [
                        'art' => 'merge',
                        'name' => 'Consolidation', // @translate
                        'caption' => 'A second pass merges the parts of each article, gathers its pages and authors, and writes one summary of four to six sentences.', // @translate
                        'note' => 'Parts are joined by title, by continuation markers and by subject; a long series in several parts may not merge correctly.', // @translate
                    ],
                    [
                        'art' => 'contents',
                        'name' => 'Table of contents', // @translate
                        'caption' => 'The index is saved to the issue’s Table of contents field: one entry per article, with its pages, title, authors and summary.', // @translate
                        'note' => 'The model that wrote it is recorded with the field; an update changes nothing else, after a backup and a confirmation.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'A table of contents read by a model guides a reader through the issue; it is not a catalogue record. An unusual layout can hide an article or turn an advertisement into one, a decorative heading can pass for a title, and every summary is selective: read the pages before citing an article.', // @translate
            'example' => 'Illustrative example: the issue, its titles and its pages are invented to show the method.', // @translate
        ],
    ];

    /**
     * Words drawn inside the illustrations. Decorative — the captions carry
     * the meaning — but a reader still sees them, so they are translated.
     */
    const ART_LABELS = [
        'article'      => 'Article', // @translate
        'topic'        => 'Topic', // @translate
        'person'       => 'Person', // @translate
        'organisation' => 'Organisation', // @translate
        'place'        => 'Place', // @translate
        'subject'      => 'Subject', // @translate
        'record'       => 'Authority record', // @translate
        'review'       => 'Needs review', // @translate
        'accepted'     => 'Accepted', // @translate
        'newRecord'    => 'New record', // @translate
        'spatial'      => 'Spatial coverage', // @translate
        'scan'         => 'Scan', // @translate
        'text'         => 'Text', // @translate
        'ocr'          => 'OCR', // @translate
        'corrected'    => 'Corrected', // @translate
        'kept'         => 'Kept as printed', // @translate
        'leftOut'      => 'Left out', // @translate
        'advert'       => 'Advertisement', // @translate
        'contents'     => 'Table of contents', // @translate
    ];

    /** Heading levels an editor may give the block title; routes go one below. */
    const HEADING_LEVELS = ['h2', 'h3', 'h4'];

    const DEFAULT_HEADING_LEVEL = 'h3';

    public static function ids(): array
    {
        return array_keys(self::PRESETS);
    }

    /** A saved preset id, or the default for a missing or retired one. */
    public static function resolve(?string $id): string
    {
        return $id !== null && isset(self::PRESETS[$id]) ? $id : self::DEFAULT_PRESET;
    }

    public static function headingLevel(?string $level): string
    {
        return in_array($level, self::HEADING_LEVELS, true) ? $level : self::DEFAULT_HEADING_LEVEL;
    }

    /**
     * The preset with every string passed through `$translate`, in the shape
     * the template renders and the Svelte component receives as JSON.
     *
     * @param callable(string): string $translate
     */
    public static function content(string $id, string $headingLevel, callable $translate): array
    {
        $preset = self::PRESETS[self::resolve($id)];
        $level = self::headingLevel($headingLevel);
        $routes = [];
        foreach ($preset['routes'] as $route) {
            $stages = [];
            foreach ($route['stages'] as $stage) {
                $stages[] = [
                    'art' => $stage['art'],
                    'name' => $translate($stage['name']),
                    'caption' => $translate($stage['caption']),
                    'note' => isset($stage['note']) ? $translate($stage['note']) : '',
                ];
            }
            $routes[] = [
                'id' => $route['id'],
                'title' => isset($route['title']) ? $translate($route['title']) : '',
                'stages' => $stages,
            ];
        }
        $labels = [];
        foreach (self::ART_LABELS as $key => $label) {
            $labels[$key] = $translate($label);
        }
        return [
            'preset' => self::resolve($id),
            'headingLevel' => $level,
            'routeHeadingLevel' => 'h' . min(6, (int) substr($level, 1) + 1),
            'title' => $translate($preset['title']),
            'lede' => $translate($preset['lede']),
            'routes' => $routes,
            'caveat' => $translate($preset['caveat']),
            'example' => $translate($preset['example']),
            'labels' => $labels,
        ];
    }
}
