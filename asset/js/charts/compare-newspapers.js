/**
 * IWAC Visualizations — Compare Newspapers block (orchestrator)
 *
 * Two-side comparison UI. Each side (A, B) picks:
 *   - type:  articles | publications
 *   - scope: country  | newspaper
 *   - name:  the specific country or newspaper from the index
 *
 * Data:
 *   asset/data/compare-newspapers/index.json
 *   asset/data/compare-newspapers/<type>/(country|newspaper)-<slug>.json
 *
 * Panels rendered when both sides are loaded:
 *   1. Metrics row (side-by-side values per metric)
 *   2. Timeline — overlapping line chart
 *   3. Subject overlap — clickable tags (shared / only-A / only-B)
 *   4. Spatial overlap — clickable tags
 *   5. Geographic map — MapLibre bubbles for each side
 *   6. Top subjects bar chart (side by side)
 *   7. Wordclouds — side by side
 *   8. Sentiment comparison (articles only, per-model picker)
 *   9. Newspapers breakdown (country-scope sides only)
 *
 * The panel builders + shared helpers live in companion files under
 * compare-newspapers/ (helpers, picker, metrics, overlap, timeline,
 * subjects, wordclouds, map, sentiment, newspapers), all loaded before
 * this orchestrator via the block's 'panels' asset list and hanging
 * off IWACVis.compareNewspapers. This file keeps the data loading,
 * the picker wiring, chart disposal, and the load/compare flow.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers: missing panels — check script load order');
        return;
    }
    var P = ns.panels;

    // Alias the builders locally so the call sites below read exactly
    // as they did before the split.
    var CN = ns.compareNewspapers || {};
    var buildPicker = CN.buildPicker;
    var buildMetrics = CN.buildMetrics;
    var buildOverlapPanel = CN.buildOverlapPanel;
    var buildTimeline = CN.buildTimeline;
    var buildTopSubjects = CN.buildTopSubjects;
    var buildWordclouds = CN.buildWordclouds;
    var buildMap = CN.buildMap;
    var buildSentiment = CN.buildSentiment;
    var buildNewspapersBreakdown = CN.buildNewspapersBreakdown;

    var SIDES = ['A', 'B'];


    /* ----------------------------------------------------------------- */
    /*  Data loading                                                      */
    /* ----------------------------------------------------------------- */

    function indexUrl(basePath) {
        return basePath + P.DATA_BASE + 'compare-newspapers/index.json';
    }

    function corpusUrl(basePath, type, scope, slug) {
        return basePath + P.DATA_BASE + 'compare-newspapers/'
            + type + '/' + scope + '-' + slug + '.json';
    }

    // Delegates to the shared helper so corpus JSONs get the same
    // credentials + `?v=` cache-busting treatment as every other block.

    /* ----------------------------------------------------------------- */
    /*  Orchestrator                                                      */
    /* ----------------------------------------------------------------- */

    function disposeCharts(root) {
        // The instance + map + observer teardown is dashboard-core's now
        // (`ns.disposeWithin`, promoted from here in v1.59.0 so the other
        // view-switching blocks could share it). What stays block-specific
        // is the observer this block attaches to its own map hosts.
        if (ns.disposeWithin) ns.disposeWithin(root);

        // Tear down any ResizeObservers we attached directly to map hosts
        // so they don't fire against disposed maps when the user picks a
        // new corpus.
        var mapHosts = root.querySelectorAll('.iwac-vis-compare-map');
        for (var j = 0; j < mapHosts.length; j++) {
            var ro = mapHosts[j]._iwacResizeObserver;
            if (ro && typeof ro.disconnect === 'function') {
                try { ro.disconnect(); } catch (e) {}
                mapHosts[j]._iwacResizeObserver = null;
            }
        }
    }

    function renderResults(resultsRoot, dataA, dataB, ctx) {
        disposeCharts(resultsRoot);
        resultsRoot.innerHTML = '';

        resultsRoot.appendChild(buildMetrics(dataA, dataB));

        var grid = P.el('div', 'iwac-vis-compare-grid');
        resultsRoot.appendChild(grid);

        grid.appendChild(buildTimeline(dataA, dataB));
        grid.appendChild(buildOverlapPanel('Subject overlap',
            dataA.subjects, dataB.subjects, dataA, dataB, ctx));
        grid.appendChild(buildOverlapPanel('Spatial coverage overlap',
            dataA.spatial, dataB.spatial, dataA, dataB, ctx));

        var mapPanel = buildMap(dataA, dataB, ctx);
        if (mapPanel) grid.appendChild(mapPanel);

        grid.appendChild(buildTopSubjects(dataA, dataB));
        grid.appendChild(buildWordclouds(dataA, dataB));

        var sentimentPanel = buildSentiment(dataA, dataB);
        if (sentimentPanel) grid.appendChild(sentimentPanel);

        var papers = buildNewspapersBreakdown(dataA, dataB);
        if (papers) grid.appendChild(papers);
    }

    /**
     * Is `{type, scope, slug}` a corpus the index actually carries? The URL
     * can name anything; only a real one is worth a fetch.
     */
    function knownCorpus(index, pick) {
        if (!pick || !pick.type || !pick.scope || !pick.slug) return false;
        var subset = index.subsets && index.subsets[pick.type];
        if (!subset) return false;
        var list = pick.scope === 'country' ? subset.countries
            : pick.scope === 'newspaper' ? subset.newspapers : null;
        if (!list) return false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].slug === pick.slug) return true;
        }
        return false;
    }

    /** `articles/country/benin` ↔ {type, scope, slug}. */
    function serializeCorpus(pick) {
        return pick && pick.slug ? [pick.type, pick.scope, pick.slug].join('/') : null;
    }

    function parseCorpus(raw) {
        var parts = String(raw).split('/');
        if (parts.length !== 3) return undefined;
        return { type: parts[0], scope: parts[1], slug: parts[2] };
    }

    function pickDefaults(index) {
        var subset = index.subsets && index.subsets.articles;
        var countries = (subset && subset.countries) || [];
        var defA = { type: 'articles', scope: 'country',
                     slug: countries[0] && countries[0].slug };
        var defB = { type: 'articles', scope: 'country',
                     slug: countries[1] && countries[1].slug || (countries[0] && countries[0].slug) };
        if (!defA.slug) {
            var pub = index.subsets && index.subsets.publications;
            if (pub && pub.countries && pub.countries.length) {
                defA = { type: 'publications', scope: 'country', slug: pub.countries[0].slug };
                defB = { type: 'publications', scope: 'country',
                         slug: pub.countries[Math.min(1, pub.countries.length - 1)].slug };
            }
        }
        return { A: defA, B: defB };
    }

    function render(container, index, ctx) {
        container.innerHTML = '';

        var root = P.el('div', 'iwac-vis-compare-root');
        container.appendChild(root);

        var pickersEl = P.el('div', 'iwac-vis-compare-pickers');
        root.appendChild(pickersEl);

        var resultsRoot = P.el('div', 'iwac-vis-compare-results');
        root.appendChild(resultsRoot);

        var defaults = pickDefaults(index);
        // The two picks are the block's state, and the address:
        // `?cmp.a=articles/country/benin&cmp.b=publications/newspaper/…`.
        var picks = P.createStore({ A: defaults.A, B: defaults.B });
        var url = P.bindUrlState ? P.bindUrlState(picks, {
            prefix: 'cmp',
            keys: SIDES.map(function (side) {
                return {
                    key: side,
                    param: side.toLowerCase(),
                    serialize: serializeCorpus,
                    parse: parseCorpus,
                    validate: function (pick) { return knownCorpus(index, pick); }
                };
            })
        }) : null;
        var state = { A: null, B: null };
        var pickers = {};

        // Latest-wins per side. Every picker change fetched its corpus and
        // whichever response landed LAST won, so switching side A from a
        // country (a large file) to one newspaper (a small one) rendered the
        // newspaper and then, when the slower country file arrived, silently
        // repainted A as the country while the picker still said the
        // newspaper. A sequence number drops the superseded response; the
        // AbortController stops it holding a connection slot as well.
        var seq = { A: 0, B: 0 };
        var inflight = { A: null, B: null };

        function onPickerChange(side) {
            return function (pickerState) {
                var url = corpusUrl(ctx.basePath,
                    pickerState.type, pickerState.scope, pickerState.slug);
                if (inflight[side]) {
                    try { inflight[side].abort(); } catch (e) { /* already settled */ }
                }
                var controller = typeof AbortController !== 'undefined'
                    ? new AbortController() : null;
                inflight[side] = controller;
                var mine = ++seq[side];
                var opts = controller ? { signal: controller.signal } : undefined;

                P.fetchJSON(url, opts).then(function (data) {
                    if (mine !== seq[side]) return;   // superseded by a newer pick
                    inflight[side] = null;
                    state[side] = data;
                    if (state.A && state.B) {
                        renderResults(resultsRoot, state.A, state.B, ctx);
                    } else {
                        resultsRoot.innerHTML = '';
                        resultsRoot.appendChild(P.el('div', 'iwac-vis-compare-empty',
                            P.t('Choose two corpora to compare')));
                    }
                }).catch(function (err) {
                    if (mine !== seq[side]) return;   // our own abort, or superseded
                    inflight[side] = null;
                    console.error('IWACVis compare-newspapers:', err);
                    disposeCharts(resultsRoot);
                    resultsRoot.innerHTML = '';
                    resultsRoot.appendChild(P.buildFetchErrorState(err));
                });
            };
        }

        SIDES.forEach(function (side) {
            var picker = buildPicker(side, index, picks.state[side], function (pickerState) {
                picks.set(side, pickerState);
            });
            pickers[side] = picker;
            pickersEl.appendChild(picker.root);
        });

        if (url && P.buildCopyLinkButton) {
            pickersEl.appendChild(P.buildCopyLinkButton({ href: url.href }));
        }

        // A pick — from its picker, or restored from the URL — fetches its
        // corpus; the picker is told either way so the two never disagree.
        var load = { A: onPickerChange('A'), B: onPickerChange('B') };
        picks.subscribe(function (keys) {
            keys.forEach(function (side) {
                if (!pickers[side]) return;
                pickers[side].set(picks.state[side]);
                load[side](pickers[side].getState());
            });
        });

        SIDES.forEach(function (side) {
            load[side](pickers[side].getState());
        });
    }

    P.bootBlock({
        selector:       '.iwac-vis-compare-newspapers',
        warnLabel:      'IWACVis compare-newspapers index',
        requireECharts: true,
        load:           function (ctx) { return P.fetchJSON(indexUrl(ctx.basePath)); },
        render:         render
    });
})();
