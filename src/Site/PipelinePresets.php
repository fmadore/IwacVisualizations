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
        'ask-ai'            => 'Ask AI: from a question to a cited answer', // @translate
        'press-attitudes'   => 'Press attitudes: how language models rate the articles', // @translate
        'embeddings'        => 'Embeddings: similar meaning and possible reprints', // @translate
        'places-map'        => 'Places on the map: from a linked place to a bubble', // @translate
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
        // Follows the iwac-mcp-server repository: the tool registry
        // (39 read-only tools, `readOnlyHint`), the handshake instructions
        // and prompts, the dataset loader (public Hugging Face dataset by
        // default, ~265 MB cached by the Desktop extension) and the
        // provenance every successful call carries.
        'ask-ai' => [
            'title' => 'How an AI assistant answers a question with IWAC', // @translate
            'lede' => 'The IWAC MCP server lets an AI assistant you already use search the collection for you. The server supplies records and figures, read-only; the assistant plans the searches, reads what comes back and writes the answer.', // @translate
            'routes' => [[
                'id' => 'mcp',
                'stages' => [
                    [
                        'art' => 'question',
                        'name' => 'Your question', // @translate
                        'caption' => 'You ask in any language, in Claude, ChatGPT or another assistant connected to IWAC; the assistant decides which IWAC tools to call.', // @translate
                        'note' => 'Most sources are in French, so the instructions have it search in French, with spelling variants, whatever language you write in.', // @translate
                    ],
                    [
                        'art' => 'tools',
                        'name' => 'Tool calls', // @translate
                        'caption' => 'The server offers 39 read-only tools: search the collection, read one record, look up a person or a place, count over time, compare countries.', // @translate
                        'note' => 'Built-in instructions, and an optional research skill, tell the assistant how to search, read and cite.', // @translate
                    ],
                    [
                        'art' => 'dataset',
                        'name' => 'The dataset', // @translate
                        'caption' => 'Each call is answered from IWAC’s research dataset on Hugging Face; the Claude Desktop extension keeps a copy on your computer.', // @translate
                        'note' => 'Search matches the words of the metadata and the OCR text, so a misread word stays hidden.', // @translate
                    ],
                    [
                        'art' => 'results',
                        'name' => 'Results with their sources', // @translate
                        'caption' => 'Each result comes back with the link to its IWAC record, and each call records the version of the dataset that answered it.', // @translate
                        'note' => 'A warning says when a list was cut short or a kind of material could not be searched.', // @translate
                    ],
                    [
                        'art' => 'answer',
                        'name' => 'The answer', // @translate
                        'caption' => 'The assistant may search again or open records, then writes the answer, citing each source by its IWAC link.', // @translate
                        'note' => 'The wording is the model’s, not IWAC’s: follow the links before relying on a claim.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'The server returns records; the assistant interprets them. A count describes what IWAC holds, not everything that was ever published, and an assistant can miss a spelling variant or misread a source: open the linked records before quoting them.', // @translate
            'example' => 'Illustrative example: the question, the tool calls and the results in the drawings are invented to show the method.', // @translate
        ],
        // Follows iwac-ai-pipelines `AI_sentiment_analysis/` (the eligible
        // languages, the prompt and its label scales, the consistency rule
        // for "Non abordé", the per-model Omeka properties) and this
        // module's Sentiment Atlas (`generate_sentiment_atlas.py`: every
        // model kept apart, agreement measured, no majority label). The
        // panel is `config/sentiment-models.json` `active`; name no count
        // in a caption that the next model would make false.
        'press-attitudes' => [
            'title' => 'How language models rate the press’s portrayal of Islam', // @translate
            'lede' => 'Several large language models read the same newspaper articles, and each rates on its own how central Islam and Muslims are to an article, how positively or negatively they are portrayed, and how subjective the writing is.', // @translate
            'routes' => [[
                'id' => 'sentiment',
                'stages' => [
                    [
                        'art' => 'article',
                        'name' => 'Articles', // @translate
                        'caption' => 'The OCR text of each French- or English-language newspaper article is sent whole, one article at a time.', // @translate
                        'note' => 'Articles in Ewé, Kabiyè or Dendi, or with no language recorded, are left out: a few dozen in all.', // @translate
                    ],
                    [
                        'art' => 'panel',
                        'name' => 'One task, several models', // @translate
                        'caption' => 'Every model receives the same instructions, in French, and rates the article independently of the others.', // @translate
                        'note' => 'Their settings are not identical: temperature and reasoning effort follow each provider.', // @translate
                    ],
                    [
                        'art' => 'ratings',
                        'name' => 'Three ratings', // @translate
                        'caption' => 'Centrality runs from very central to not addressed, polarity from very positive to very negative, subjectivity from very objective to very subjective.', // @translate
                        'note' => 'When Islam is not addressed, polarity is “not applicable” and subjectivity is left empty.', // @translate
                    ],
                    [
                        'art' => 'reasons',
                        'name' => 'Justifications', // @translate
                        'caption' => 'Each rating comes with a sentence or two citing the article, and every model’s ratings are saved to the article’s record, apart.', // @translate
                        'note' => 'An article’s page shows each model’s reasoning beside its rating.', // @translate
                    ],
                    [
                        'art' => 'compare',
                        'name' => 'Comparison', // @translate
                        'caption' => 'The atlas follows each model across years, countries, topics and newspapers, and measures how often the models agree.', // @translate
                        'note' => 'The atlas takes no majority vote: where the models disagree, the disagreement is shown.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'The ratings are model outputs, not facts about the articles. The models agree most on centrality and least on subjectivity, one model reads centrality differently from the rest, and a model asked again can change its answer: read the article and the justification before drawing a conclusion.', // @translate
            'example' => 'Illustrative example: the article, the ratings and the agreement in the drawings are invented to show the method.', // @translate
        ],
        // Follows IWAC-Hugging-Face `post-processing/`: the local encoder
        // (_gemma_encoder.py: title-and-text document prompt, query prefix,
        // text and images in one space), the text stage (semantic_embedding.py:
        // overlapping byte-bounded chunks, length-weighted mean), the
        // neighbours (related_articles.py, top 10) and the reprint screen
        // (analyses/reprint_candidates.py, docs/research-validation.md §4);
        // and this module's Press Reprints generator (generate_reprints.py:
        // different newspapers, 0.97 alone or 0.91 with trigram Jaccard
        // ≥ 0.45) and Semantic Landscape (a UMAP projection). No caption
        // names the model or its dimension: the next model would make it false.
        'embeddings' => [
            'title' => 'How IWAC measures similar meaning, and finds possible reprints', // @translate
            'lede' => 'An embedding model turns each text into a vector, a long list of numbers, so that texts about the same thing sit close together. Those distances give the related articles on an article’s page, arrange the Semantic Landscape and flag possible reprints across newspapers.', // @translate
            'routes' => [[
                'id' => 'similarity',
                'stages' => [
                    [
                        'art' => 'passages',
                        'name' => 'Passages', // @translate
                        'caption' => 'An article’s OCR text is read with its title; a long text is cut into overlapping passages the model can read whole.', // @translate
                        'note' => 'Islamic publications are compared by their table of contents, references by their abstract.', // @translate
                    ],
                    [
                        'art' => 'vector',
                        'name' => 'Vector', // @translate
                        'caption' => 'The model, run locally rather than through an online service, turns each passage into several hundred numbers; a text’s passages are averaged into one vector.', // @translate
                        'note' => 'Photographs are placed in the same space, so a written query can find pictures as well as texts.', // @translate
                    ],
                    [
                        'art' => 'space',
                        'name' => 'Similar meaning', // @translate
                        'caption' => 'Texts that say similar things get vectors pointing in similar directions, even when they share almost no words.', // @translate
                        'note' => 'The real space has hundreds of dimensions; a flat picture, here or in the Semantic Landscape, is a projection that distorts distances.', // @translate
                    ],
                    [
                        'art' => 'score',
                        'name' => 'Similarity score', // @translate
                        'caption' => 'Cosine similarity compares two directions, up to 1 for identical ones. Each article’s ten closest texts become its related articles.', // @translate
                        'note' => 'A search is embedded the same way, marked as a query, and its results ranked by the same score.', // @translate
                    ],
                    [
                        'art' => 'reprints',
                        'name' => 'Reprint candidates', // @translate
                        'caption' => 'Two articles from different newspapers become a candidate pair at a score of 0.97, or from 0.91 if they also share many three-word sequences.', // @translate
                        'note' => 'The thresholds were calibrated against shared wording on test pairs; a reader decides whether a pair is a reprint.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'Similarity is measured, not understood. A high score can mean a shared dispatch, a press release printed twice, or only the same subject and stock phrases, while OCR errors and abridged versions can hide a real reprint. The thresholds are choices calibrated on IWAC’s articles, not facts about the texts: read both articles before calling one a reprint.', // @translate
            'example' => 'Illustrative example: the headlines, positions and scores in the drawings are invented to show the method.', // @translate
        ],
        // Follows IWAC-Hugging-Face `index/upload_index_hf.py` (a place's
        // `curation:coordinates` read as one "lat, lng" pair, nulls for a
        // missing, multiple or malformed value; `frequency` counts ITEMS —
        // articles, publications, references, audiovisual — linking the
        // authority under subject, spatial and the name fields, each item
        // once) and this module's map generators (`generate_world_map.py`,
        // `generate_spatial_exploration.py`: index rows of type Lieux with
        // valid coordinates and a positive count; country fills count items
        // by their `country`) and `P.countRadius` (radius ∝ √count). Where
        // the coordinates come from is not in the code, so no caption says.
        'places-map' => [
            'title' => 'How a place gets onto IWAC’s maps', // @translate
            'lede' => 'IWAC’s maps do not search the texts for the names of towns. They draw the places that catalogue records link to: each place is an entry in the index, and the coordinates on that entry decide where its bubble goes.', // @translate
            'routes' => [[
                'id' => 'places',
                'stages' => [
                    [
                        'art' => 'linked',
                        'name' => 'A linked place', // @translate
                        'caption' => 'An item’s record links it to place entries in the index, under Spatial coverage or Subject. A town only named in the text has no link.', // @translate
                        'note' => 'Links are made in the catalogue; some are proposed by entity extraction and confirmed by a researcher.', // @translate
                    ],
                    [
                        'art' => 'entry',
                        'name' => 'The place’s entry', // @translate
                        'caption' => 'Each place is an authority record of its own, with its name, the larger place it is part of, and its coordinates: a latitude and a longitude.', // @translate
                        'note' => 'Spelling variants of the name lead to the same record.', // @translate
                    ],
                    [
                        'art' => 'counts',
                        'name' => 'Items per place', // @translate
                        'caption' => 'For each place, the maps count the items linked to it; an item counts once, even if it links the place twice.', // @translate
                        'note' => 'The count covers articles, Islamic publications, references and audiovisual items.', // @translate
                    ],
                    [
                        'art' => 'bubbles',
                        'name' => 'Bubbles', // @translate
                        'caption' => 'Each place becomes a bubble at its coordinates. Its radius grows with the square root of the count, so it is roughly the area that follows the number of items.', // @translate
                        'note' => 'Nine times the items gives a bubble about three times as wide, not nine.', // @translate
                    ],
                    [
                        'art' => 'absent',
                        'name' => 'What stays off the map', // @translate
                        'caption' => 'A place whose entry has no coordinates, or an unreadable pair, is not drawn however many items link to it; a town named only in the text is not counted.', // @translate
                        'note' => 'Country colours, where a map shows them, count the items filed under each country, a different measure from the bubbles.', // @translate
                    ],
                ],
            ]],
            'caveat' => 'A map shows what the catalogue links, not every place the texts mention. Where indexing is fuller, places look more important, and a place without coordinates is missing however often items cite it. Read a bubble as a count of linked items, not as a measure of a town’s importance.', // @translate
            'example' => 'Illustrative example: the towns and their approximate coordinates are real; the article, its links and the counts are invented to show the method.', // @translate
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
        'question'     => 'How did the press in Benin cover Tabaski?', // @translate
        'searchTerms'  => 'Searched as', // @translate
        'dataset'      => 'IWAC dataset', // @translate
        'version'      => 'Dataset version recorded', // @translate
        'answer'       => 'Answer', // @translate
        'centrality'   => 'Centrality', // @translate
        'polarity'     => 'Polarity', // @translate
        'subjectivity' => 'Subjectivity', // @translate
        'model'        => 'Model', // @translate
        'agree'        => 'Agree', // @translate
        'disagree'     => 'Disagree', // @translate
        'toCheck'      => 'To check', // @translate
        'partOf'       => 'Part of', // @translate
        'coordinates'  => 'Coordinates', // @translate
        'items'        => 'Linked items', // @translate
        'noCoordinates' => 'No coordinates', // @translate
        'textOnly'     => 'Named in the text only', // @translate
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
