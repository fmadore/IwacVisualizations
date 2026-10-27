/**
 * IWAC Visualizations — Albani Zaria sermons: how the exhibition was made.
 *
 * The methods and their sources in plain language, for a reader who has
 * never met a collocate or a stop word: where the text comes from, which
 * recordings count, how words are counted and which are left out, how
 * Hausa is told from Arabic, what the word lists are, how "words that
 * travel together" are found, what may be quoted, and how to read the
 * result. Each claim the page rests on is stated here once, with the
 * published work behind it.
 *
 * The references are bibliographic data, not interface text: a title is
 * cited in its own language on both sites, so they live here rather than
 * in the dictionaries.
 *
 * Depends on: albani-sermons/helpers.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var A = ns.albaniSermons;

    /** The explanations, in reading order: [title key, body key]. */
    var ITEMS = [
        ['albani_method_source', 'albani_method_source_body'],
        ['albani_method_scope', 'albani_method_scope_body'],
        ['albani_method_spelling', 'albani_method_spelling_body'],
        ['albani_method_stopwords', 'albani_method_stopwords_body'],
        ['albani_method_layers', 'albani_method_layers_body'],
        ['albani_method_lexicon', 'albani_method_lexicon_body'],
        ['albani_method_collocates', 'albani_method_collocates_body'],
        ['albani_method_rights', 'albani_method_rights_body'],
        ['albani_method_reading', 'albani_method_reading_body']
    ];

    var REFERENCES = [
        {
            text: 'Bashir, A. S., Bichi, A. A. & Adamu, A. (2024). Automatic construction of generic Hausa '
                + 'language stop words list using term frequency-inverse document frequency. '
                + 'Journal of Electrical Systems and Information Technology, 11, 58.',
            url: 'https://doi.org/10.1186/s43067-024-00187-5',
            useKey: 'albani_ref_use_stopwords'
        },
        {
            text: 'Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate: a practical and '
                + 'powerful approach to multiple testing. Journal of the Royal Statistical Society, '
                + 'Series B, 57(1), 289–300.',
            url: 'https://doi.org/10.1111/j.2517-6161.1995.tb02031.x',
            useKey: 'albani_ref_use_correction'
        },
        {
            text: 'Dunning, T. (1993). Accurate methods for the statistics of surprise and coincidence. '
                + 'Computational Linguistics, 19(1), 61–74.',
            url: 'https://aclanthology.org/J93-1003/',
            useKey: 'albani_ref_use_test'
        },
        {
            text: 'Hardie, A. (2014). Log Ratio – an informal introduction. Centre for Corpus Approaches to '
                + 'Social Science, Lancaster University.',
            url: 'https://cass.lancs.ac.uk/log-ratio-an-informal-introduction/',
            useKey: 'albani_ref_use_ratio'
        }
    ];

    A.renderMethod = function (section, metadata) {
        var params = (metadata && metadata.params) || {};
        var grid = P.el('div', 'iwac-vis-albani__method-grid');
        ITEMS.forEach(function (item) {
            var block = P.el('div', 'iwac-vis-albani__method-item');
            block.appendChild(P.el('h4', null, P.t(item[0])));
            block.appendChild(P.el('p', null, P.t(item[1], {
                window: params.window || 5,
                minutes: params.segment_minutes || 20
            })));
            grid.appendChild(block);
        });
        section.appendChild(grid);

        var sources = P.el('div', 'iwac-vis-albani__sources');
        sources.appendChild(P.el('h4', null, P.t('albani_sources')));
        var list = P.el('ol', 'iwac-vis-albani__references');
        REFERENCES.forEach(function (ref) {
            var li = P.el('li');
            li.appendChild(P.el('span', null, ref.text + ' '));
            var a = P.el('a', 'iwac-vis-albani__reference-link', ref.url);
            a.href = ref.url;
            a.rel = 'noopener';
            li.appendChild(a);
            li.appendChild(P.el('span', 'iwac-vis-albani__reference-use', ' — ' + P.t(ref.useKey)));
            list.appendChild(li);
        });
        sources.appendChild(list);
        section.appendChild(sources);
    };
})();
