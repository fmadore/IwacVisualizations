/**
 * IWAC Visualizations — Topic Explorer block (orchestrator)
 *
 * First end-to-end consumer of the v0.16.0 declarative dashboard
 * layout system. The block has two modes:
 *
 *   1. **Overview** — summary cards, a treemap of all 30 LDA topics
 *      sized by article count, and a responsive grid of topic cards.
 *      Clicking either a treemap cell or a card swaps to the detail
 *      view for that topic.
 *
 *   2. **Per-topic detail** — calendar heatmap of articles for the
 *      topic, country / newspaper distribution bars, and a strip of
 *      the most representative articles (sorted by ``lda_topic_prob``).
 *      Built declaratively from the registered ``topicDetail`` layout
 *      via ``IWACVis.dashboardLayout.render()``.
 *
 * Backed by ``asset/data/topic-explorer.json`` produced by
 * ``scripts/generate_topic_explorer.py``.
 *
 * Dependencies (declared via the partial in ``topic-explorer.phtml``):
 *   chart-options, dashboard-layout, calendar-heatmap renderer,
 *   horizontal-bar renderer, similar-items renderer, treemap renderer.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.dashboardLayout) {
        console.warn('IWACVis topic explorer: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var C  = ns.chartOptions;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Per-topic detail layout — declarative slot list                   */
    /* ----------------------------------------------------------------- */
    //
    // Each slot reads from a shared data bundle whose keys are the
    // dataKey values below. shouldRender filters out slots whose
    // slice fails the renderer's predicate, so a topic with no
    // datable articles silently drops the calendar slot — no "No
    // data available" placeholder.

    DL.register('topicDetail', [
        {
            chart: 'calendarHeatmap',
            wide: true,
            dataKey: 'calendar',
            title: 'cal_panel_title',
            description: 'desc_topic_calendar',
            // Month grid by default: a topic's articles spread over six
            // decades render as near-empty whitespace at day resolution.
            // Day and Hijri stay one click away in the renderer's facet bar.
            options: { granularity: 'month', unitKey: 'articles_count' }
        },
        // The generator emits [{name, value}, ...] capped at 15; `maxBars`
        // takes the last three off. `categoryName`, `valueName` and
        // `maxLabelLength` used to sit here too and were inert the whole
        // time — C.horizontalBar reads none of the three. It draws no axis
        // names by design, and it truncates category labels by PIXEL width
        // (180px, narrowed on phones by R.labelMedia) rather than by
        // character count, which is the right unit for a proportional face.
        {
            chart: 'horizontalBar',
            dataKey: 'country_distribution',
            title: 'Top countries',
            description: 'desc_topic_countries',
            // Countries get their fixed palette slots, as everywhere else a
            // chart in this module ranks them.
            options: { maxBars: 12, useCountryColors: true }
        },
        {
            chart: 'horizontalBar',
            dataKey: 'newspaper_distribution',
            title: 'Top newspapers',
            description: 'desc_topic_newspapers',
            // Not useCountryColors: a top-N of newspapers is not a country
            // scale and must not borrow its colours.
            options: { maxBars: 12 }
        },
        {
            chart: 'similarItems',
            wide: true,
            dataKey: 'top_articles',
            title: 'Most representative articles',
            description: 'desc_topic_top_articles',
            // similarItems' default lowSignal threshold (0.4) was chosen
            // for cosine-similarity scores; here we're passing topic_prob
            // values that can range from ~0.3 to 1.0 across topics, so
            // drop the threshold to surface every representative article.
            options: { max: 10, lowSignal: 0 }
        }
    ]);

    /* ----------------------------------------------------------------- */
    /*  Deep linking — ?topic=<id>                                        */
    /* ----------------------------------------------------------------- */
    //
    // A topic's detail view is a destination, not a transient UI state:
    // it is what gets cited in a footnote, pasted into an email, or
    // bookmarked. So it earns a URL. A query parameter rather than a
    // hash, because the hash is already the page's anchor namespace and
    // an Omeka page ignores query params it doesn't know.
    //
    // The binding is the shared one (P.bindUrlState): the parameter stays
    // the bare `topic` it has always been, so links already cited keep
    // working, and every browser-side failure — a sandboxed iframe throwing
    // on pushState, a missing `URL` — leaves the block working and the
    // address bar as it is.

    var URL_PARAM = 'topic';

    /**
     * `?topic=` → the id of a topic the bundle holds, or null for the
     * overview. Null rather than "rejected" for a bad value, so Back onto
     * an address naming no topic shows the overview instead of leaving the
     * last topic open under it.
     */
    function topicUrlKey(data) {
        return {
            key: 'topic',
            param: URL_PARAM,
            parse: function (raw) {
                var id = parseInt(raw, 10);
                return !isNaN(id) && findTopic(data, id) ? id : null;
            }
        };
    }

    function findTopic(data, topicId) {
        return (data.topics || []).find(function (t) { return t.id === topicId; }) || null;
    }

    /* ----------------------------------------------------------------- */
    /*  Bootstrapping                                                     */
    /* ----------------------------------------------------------------- */


    P.bootBlock({
        selector:       '.iwac-vis-topic-explorer',
        warnLabel:      'IWACVis topic explorer',
        requireECharts: true,
        dataFile:       'topic-explorer.json',
        render:         function (container, data) { renderInitial(container, data); },
        // Drops only the spinner, keeping anything else the template rendered.
        onError:        function (container, err) {
            console.error('IWACVis topic explorer:', err);
            var loading = container.querySelector('.iwac-vis-topic-explorer__loading');
            if (loading) loading.remove();
            container.appendChild(P.buildFetchErrorState(err));
        }
    });

    /* ----------------------------------------------------------------- */
    /*  Initial render — overview shell + topic cards                     */
    /* ----------------------------------------------------------------- */

    function renderInitial(container, data) {
        var loading = container.querySelector('.iwac-vis-topic-explorer__loading');
        if (loading) loading.remove();

        var ctx = {
            siteBase: container.dataset.siteBase || '',
            data: data
        };
        var body = P.el('div', 'iwac-vis-topic-explorer__body');
        container.appendChild(body);

        // Summary stat cards — corpus-level metadata
        var meta = data.metadata || {};
        var summaryCards = [
            { value: meta.total_topics,             labelKey: 'Topics',             featured: true },
            { value: meta.total_articles_with_topic, labelKey: 'Articles classified' },
            { value: meta.outliers,                  labelKey: 'Outliers' },
            { value: meta.newspapers,                labelKey: 'Newspapers' }
        ];
        body.appendChild(P.buildSummaryCards(summaryCards));
        var period = P.buildPeriodSubtitle(meta.year_min, meta.year_max);
        if (period) body.appendChild(period);

        // Two view containers — one visible, one hidden, swap on
        // selection. Both stay mounted so the back button restores
        // the overview's scroll position naturally.
        var overview = P.el('div', 'iwac-vis-topic-explorer__view iwac-vis-topic-explorer__overview is-active');
        var detail   = P.el('div', 'iwac-vis-topic-explorer__view iwac-vis-topic-explorer__detail');
        body.appendChild(overview);
        body.appendChild(detail);

        // One state key, the open topic (null: the overview). Opening a
        // topic or leaving it is a navigation, so it gets its own history
        // entry and Back / Forward move between the overview and topics
        // (`push`). `root` stamps `data-url-state="topic"`: a topic's panels
        // only exist while it is open, so an embed of one carries `?topic=`
        // (embed.js stateQuery reads this).
        var store = P.createStore({ topic: null });
        var topicKey = topicUrlKey(data);
        var url = P.bindUrlState(store, {
            root: container,
            keys: [topicKey],
            push: function (keys) { return keys.indexOf('topic') !== -1; }
        });
        var nav = { overview: overview, detail: detail, ctx: ctx, href: url.href };

        // Scroll to a topic only when the reader opened it here; on Back /
        // Forward the browser restores the scroll position itself.
        var scrollNext = false;
        store.subscribe(function () {
            var id = store.state.topic;
            var scroll = scrollNext;
            scrollNext = false;
            if (id == null) showOverview(nav);
            else showDetail(nav, id, scroll);
        }, { keys: ['topic'] });

        nav.select = function (topicId) {
            if (topicId != null && !findTopic(data, topicId)) return;
            scrollNext = true;
            store.set('topic', topicId);
        };

        renderOverview(overview, data, nav.select);

        // Landing straight on ?topic=7 opens that topic (the binding has
        // already read it). The address is rewritten with replaceState, not
        // pushed, so the entry the reader arrived on stays the topic itself
        // and Back leaves the page instead of bouncing to an overview they
        // never saw.
        if (store.state.topic != null) {
            showDetail(nav, store.state.topic, true);
            url.sync([]);
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Overview view — treemap + topic cards                             */
    /* ----------------------------------------------------------------- */

    /*
     * The outline. The block sits straight under the page's <h1> with no
     * heading of its own, so what it shows are the page's sections, at <h2>:
     * the overview's two panels and its "All topics" list, or the open
     * topic's title, with that topic's panels under it at <h3>. They were
     * <h4> panels and <h3> headings under the <h1> (axe: heading-order) —
     * the Collection Overview and Sentiment Atlas fix again. The look does
     * not follow the level (iwac-core.css, blocks/topic-explorer.css).
     */
    var SECTION = { heading: 'h2' };

    function renderOverview(host, data, onTopicSelected) {
        // Treemap of all topics — sized by article count, click → drill
        var grid = P.buildChartsGrid();
        host.appendChild(grid);

        // The description counts the topics the treemap draws. It said "30"
        // whatever the bundle held; with none there is nothing to describe
        // (French "one" covers 0, and "the one theme" would be false).
        var topicCount = (data.topics || []).length;
        var treemapPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-topic-explorer__treemap',
            P.t('Topic distribution'),
            topicCount ? P.t('desc_topic_treemap', { count: topicCount }) : null,
            SECTION
        );
        grid.appendChild(treemapPanel.panel);

        var treemapTree = {
            name: P.t('Topics'),
            children: (data.topics || []).map(function (t) {
                // Top two words make a readable cell label; the full
                // word list still appears in the tooltip via name.
                var nameBits = (t.top_words || []).slice(0, 2);
                var displayName = nameBits.length
                    ? nameBits.join(' · ')
                    : (t.label || (P.t('Topic') + ' ' + t.id));
                return {
                    name: displayName,
                    value: t.article_count,
                    topicId: t.id
                };
            })
        };

        var instance = ns.registerChart(treemapPanel.chart, function (_e, chart) {
            chart.setOption(
                ns.chartOptions.treemap(treemapTree, { rootName: P.t('Topics') }),
                true
            );
        });
        if (instance) {
            instance.on('click', function (params) {
                if (params.data && params.data.topicId != null) {
                    onTopicSelected(params.data.topicId);
                }
            });
        }

        // Topics over time — share-of-attention stacked area (ROADMAP 9.1)
        renderTopicRiver(grid, data, onTopicSelected);

        // Topic cards grid — every topic, click drills in
        var listLabel = P.el('h2', 'iwac-vis-section-heading', P.t('All topics'));
        host.appendChild(listLabel);

        var topicGrid = P.el('div', 'iwac-vis-topic-explorer__topics');
        host.appendChild(topicGrid);

        (data.topics || []).forEach(function (t) {
            var card = buildTopicCard(t);
            card.addEventListener('click', function () {
                onTopicSelected(t.id);
            });
            topicGrid.appendChild(card);
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Topics over time — 100%-stacked share of classified articles      */
    /* ----------------------------------------------------------------- */
    //
    // Two weightings of the same question, switchable from a facet bar:
    //
    //   dominant  100%-stacked share of *classified articles*, from the
    //             per-topic `year_distribution` counts. Answers "how many
    //             articles is this topic the best single label for". A
    //             100%-stacked area beats themeRiver here — standard
    //             cartesian axes + dataZoom read as research instrument,
    //             not editorial flourish — and the share encoding factors
    //             out six decades of corpus growth.
    //
    //   weighted  stacked *mean probability mass* per year, from the
    //             bundle's `prevalence` block (`lda_topic_topk`). Answers
    //             "how much of the corpus's attention went to this topic",
    //             which is what an article split 0.34/0.33/0.33 makes of
    //             the dominant-topic count: misleadingly sharp.
    //
    // The weighted view is deliberately NOT normalised to 100%. Only each
    // article's top 3 topics are on the Hub, so the stack tops out at the
    // captured mass (~85%) and the headroom to 100% *is* the missing tail.
    // Renormalising would make a partial measurement look complete.

    function topicSeriesName(topic) {
        var bits = (topic.top_words || []).slice(0, 2);
        if (bits.length) return bits.join(' · ');
        return topic.label || (P.t('Topic') + ' ' + topic.id);
    }

    /** Dominant-topic view: article counts per year, per topic. */
    function dominantView(data) {
        var topics = (data.topics || []).slice()
            .sort(function (a, b) { return b.article_count - a.article_count; });
        if (!topics.length) return null;

        var yearSet = {};
        topics.forEach(function (t) {
            (t.year_distribution || []).forEach(function (e) { yearSet[e.name] = true; });
        });
        var years = Object.keys(yearSet).sort();
        if (years.length < 2) return null;

        var defs = topics.map(function (t) {
            var m = {};
            (t.year_distribution || []).forEach(function (e) { m[e.name] = e.value; });
            return {
                topicId: t.id,
                name: topicSeriesName(t),
                values: years.map(function (y) { return m[y] || 0; })
            };
        });
        defs = C.foldTopicTail(defs, years.length);

        // Share of the year's classified total, so every year sums to 100%.
        var totals = years.map(function (_, i) {
            return defs.reduce(function (s, d) { return s + d.values[i]; }, 0);
        });
        return {
            key: 'dominant',
            years: years,
            defs: defs,
            max: 100,
            plot: function (d, i) {
                return totals[i] ? Math.round(1000 * d.values[i] / totals[i]) / 10 : 0;
            },
            rowSuffix: function (d, i) { return ' (' + P.formatNumber(d.values[i]) + ')'; }
        };
    }

    /** Probability-weighted view: mean topic mass per year, un-normalised. */
    function weightedView(data) {
        var prev = data.prevalence;
        if (!prev || !prev.series || !prev.series.length) return null;
        var years = (prev.years || []).map(String);
        if (years.length < 2) return null;

        var byId = {};
        (data.topics || []).forEach(function (t) { byId[t.id] = t; });

        var defs = prev.series.map(function (s) {
            var topic = byId[s.id] || { id: s.id, label: s.label };
            return {
                topicId: s.id,
                name: topicSeriesName(topic),
                values: (s.values || []).slice()
            };
        });
        defs = C.foldTopicTail(defs, years.length);

        return {
            key: 'weighted',
            years: years,
            defs: defs,
            // Headroom above the captured mass is the point — leave the
            // axis at 100% so the truncation is visible rather than
            // rescaled away.
            max: 100,
            plot: function (d, i) { return Math.round(1000 * d.values[i]) / 10; },
            rowSuffix: function () { return ''; }
        };
    }

    function renderTopicRiver(grid, data, onTopicSelected) {
        var views = {};
        var order = [];
        var dominant = dominantView(data);
        if (dominant) { views.dominant = dominant; order.push('dominant'); }
        var weighted = weightedView(data);
        if (weighted) { views.weighted = weighted; order.push('weighted'); }
        if (!order.length) return;

        var meta = data.metadata || {};
        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('topics_over_time_title'),
            P.t('topics_over_time_desc'),
            SECTION
        );
        grid.appendChild(panel.panel);

        var active = order[0];
        var instance = null;
        var currentDefs = views[active].defs;

        // The two weightings answer different questions, so the caveat
        // travels with the active view rather than sitting in one shared
        // description that would be wrong half the time.
        var note = P.el('p', 'iwac-vis-panel-desc');

        function noteText() {
            if (active !== 'weighted') return P.t('topics_over_time_dominant_note');
            return P.t('topics_over_time_weighted_note', {
                k:    meta.prevalence_k || 3,
                mass: Math.round((meta.prevalence_mean_captured_mass || 0) * 100)
            });
        }

        function draw() {
            var view = views[active];
            currentDefs = view.defs;
            if (!instance) return;
            var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
            if (!live) return;
            // Same axes, different series: a merge keeps the legend toggles
            // across the dominant / weighted switch.
            if (ns.repaint) ns.repaint(live, optionFor(view));
            else live.setOption(optionFor(view), true);
        }

        function optionFor(view) {
            return C.topicRiver({
                years:     view.years,
                defs:      view.defs,
                plot:      view.plot,
                rowSuffix: view.rowSuffix,
                max:       view.max,
                // Thirty LDA topics — the legend the selector is for.
                legend:    C._legend({ top: 0, selector: true })
            });
        }

        // Only offer the switch when both weightings are available — a
        // dataset without `lda_topic_topk` gets the unchanged single view.
        if (order.length > 1 && P.buildFacetButtons) {
            var facets = P.buildFacetButtons({
                facets: [
                    { key: 'dominant', label: P.t('topics_weighting_dominant') },
                    { key: 'weighted', label: P.t('topics_weighting_weighted') }
                ],
                activeKey: active,
                onChange: function (state) {
                    active = state.facet;
                    note.textContent = noteText();
                    draw();
                }
            });
            panel.panel.insertBefore(facets.root, panel.chart);
        }

        note.textContent = noteText();
        panel.panel.insertBefore(note, panel.chart);

        instance = ns.registerChart(panel.chart, function (_e, chart) {
            chart.setOption(optionFor(views[active]), true);
        });
        if (instance) {
            instance.on('click', function (params) {
                var def = currentDefs[params.seriesIndex];
                if (def && def.topicId != null) onTopicSelected(def.topicId);
            });
        }
    }

    function buildTopicCard(topic) {
        var card = P.el('button', 'iwac-vis-topic-card');
        card.type = 'button';
        card.setAttribute('data-topic-id', topic.id);

        var head = P.el('div', 'iwac-vis-topic-card__head');
        head.appendChild(P.el('span', 'iwac-vis-topic-card__id', P.t('Topic') + ' ' + topic.id));
        head.appendChild(P.el(
            'span',
            'iwac-vis-topic-card__count',
            P.t('articles_count', { count: topic.article_count })
        ));
        card.appendChild(head);

        var words = P.el('div', 'iwac-vis-topic-card__words');
        (topic.top_words || []).slice(0, 5).forEach(function (w) {
            words.appendChild(P.el('span', 'iwac-vis-topic-card__word', w));
        });
        if (!words.childNodes.length && topic.label) {
            // Fallback if top_words is empty for some reason — show the
            // raw label so the card doesn't render as just a count.
            words.appendChild(P.el('span', 'iwac-vis-topic-card__word', topic.label));
        }
        card.appendChild(words);

        if (topic.year_min && topic.year_max) {
            card.appendChild(P.el(
                'div',
                'iwac-vis-topic-card__years',
                P.t('coverage_range', { min: topic.year_min, max: topic.year_max })
            ));
        }
        return card;
    }

    /* ----------------------------------------------------------------- */
    /*  Detail view — declarative layout via dashboardLayout.render()     */
    /* ----------------------------------------------------------------- */

    function showOverview(nav) {
        nav.detail.classList.remove('is-active');
        nav.overview.classList.add('is-active');
    }

    /**
     * Swap to a topic's detail view. Returns false when the id matches no
     * topic.
     *
     * `scroll` is false when the move came from Back/Forward: the browser
     * restores the scroll position itself, and fighting it lands the
     * reader somewhere neither of them chose.
     */
    function showDetail(nav, topicId, scroll) {
        var ctx = nav.ctx;
        var overview = nav.overview;
        var detail = nav.detail;

        var topic = findTopic(ctx.data, topicId);
        if (!topic) return false;

        overview.classList.remove('is-active');
        detail.classList.add('is-active');
        // Release the previous topic's three charts before their hosts are
        // thrown away; otherwise each detail opened added three live
        // instances that every theme toggle then re-rendered.
        if (ns.disposeWithin) ns.disposeWithin(detail);
        detail.innerHTML = '';

        detail.appendChild(buildDetailHeader(topic, function back() {
            nav.select(null);
        }, nav.href));

        // Build the slice bundle the layout's slots will read from.
        // Each key matches a slot's `dataKey`. Map topic_prob into the
        // similar-items shape's expected `similarity` field so the
        // existing renderer doesn't need a topic-explorer-specific
        // branch.
        var topArticles = (topic.top_articles || []).map(function (a) {
            var copy = {};
            for (var k in a) {
                if (Object.prototype.hasOwnProperty.call(a, k)) copy[k] = a[k];
            }
            copy.similarity = a.topic_prob;
            return copy;
        });

        DL.render(detail, 'topicDetail', {
            calendar:               {
                cells:      topic.day_cells || [],
                // Precomputed from the dataset's stored Umm al-Qura
                // dates — the renderer converts nothing.
                hijriCells: topic.hijri_cells || []
            },
            country_distribution:   topic.country_distribution || [],
            newspaper_distribution: topic.newspaper_distribution || [],
            top_articles:           topArticles
        }, {
            siteBase: ctx.siteBase,
            topic:    topic,
            // Under the topic's <h2> title, not the block's (it has none).
            panelHeading: 'h3'
        });

        // Bring the detail header into view smoothly so the user
        // doesn't have to scroll up after clicking a topic deep
        // in the overview's card grid.
        if (scroll) {
            try {
                detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) { /* old browsers ignore the options bag */ }
        }
        return true;
    }

    function buildDetailHeader(topic, onBack, href) {
        var header = P.el('div', 'iwac-vis-topic-detail__header');

        var topRow = P.el('div', 'iwac-vis-topic-detail__row');
        topRow.appendChild(P.el(
            'h2',
            'iwac-vis-topic-detail__title',
            P.t('Topic') + ' ' + topic.id
        ));
        var actions = P.el('div', 'iwac-vis-topic-detail__actions');

        var back = P.setIcon(P.el('button', 'iwac-vis-btn iwac-vis-topic-detail__back'),
            'arrow-left', P.t('Back to all topics'));
        back.type = 'button';
        back.addEventListener('click', onBack);
        actions.appendChild(back);

        // The address bar already carries the topic URL; this just makes
        // that discoverable.
        actions.appendChild(P.buildCopyLinkButton({
            href:        href,
            label:       P.t('topic_copy_link'),
            copiedLabel: P.t('topic_link_copied')
        }));

        topRow.appendChild(actions);
        header.appendChild(topRow);

        if (topic.top_words && topic.top_words.length) {
            var words = P.el('div', 'iwac-vis-topic-detail__words');
            topic.top_words.forEach(function (w) {
                words.appendChild(P.el('span', 'iwac-vis-topic-detail__word', w));
            });
            header.appendChild(words);
        }

        var meta = P.el('div', 'iwac-vis-topic-detail__meta');
        var bits = [
            { label: 'Articles', value: P.formatNumber(topic.article_count) }
        ];
        if (topic.year_min && topic.year_max) {
            bits.push({
                label: 'Period covered_short',
                value: topic.year_min + '–' + topic.year_max
            });
        }
        bits.forEach(function (b) {
            var span = P.el('span');
            span.appendChild(P.el('strong', null, P.t(b.label) + ': '));
            span.appendChild(document.createTextNode(b.value));
            meta.appendChild(span);
        });
        header.appendChild(meta);

        return header;
    }
})();
