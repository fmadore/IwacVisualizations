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
            title: 'Year × day calendar',
            description: 'desc_topic_calendar'
        },
        {
            chart: 'horizontalBar',
            dataKey: 'country_distribution',
            title: 'Top countries',
            description: 'desc_topic_countries',
            options: {
                categoryName: '',
                valueName: 'Articles',
                maxBars: 12,
                maxLabelLength: 28
            }
        },
        {
            chart: 'horizontalBar',
            dataKey: 'newspaper_distribution',
            title: 'Top newspapers',
            description: 'desc_topic_newspapers',
            options: {
                categoryName: '',
                valueName: 'Articles',
                maxBars: 12,
                maxLabelLength: 28
            }
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
    /*  Bootstrapping                                                     */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis topic explorer: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-topic-explorer');
        for (var i = 0; i < containers.length; i++) {
            initOne(containers[i]);
        }
    }

    function initOne(container) {
        var basePath = container.dataset.basePath || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/topic-explorer.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                renderInitial(container, data);
            })
            .catch(function (err) {
                console.error('IWACVis topic explorer:', err);
                var loading = container.querySelector('.iwac-vis-topic-explorer__loading');
                if (loading) loading.remove();
                container.appendChild(P.buildErrorState());
            });
    }

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

        renderOverview(overview, data, function (topicId) {
            showDetail(container, overview, detail, ctx, topicId);
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Overview view — treemap + topic cards                             */
    /* ----------------------------------------------------------------- */

    function renderOverview(host, data, onTopicSelected) {
        // Treemap of all topics — sized by article count, click → drill
        var grid = P.buildChartsGrid();
        host.appendChild(grid);

        var treemapPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-topic-explorer__treemap',
            P.t('Topic distribution'),
            P.t('desc_topic_treemap')
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

        // Topic cards grid — every topic, click drills in
        var listLabel = P.el('h3', 'iwac-vis-section-heading', P.t('All topics'));
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

    function buildTopicCard(topic) {
        var card = P.el('button', 'iwac-vis-topic-card');
        card.type = 'button';
        card.setAttribute('data-topic-id', topic.id);

        var head = P.el('div', 'iwac-vis-topic-card__head');
        head.appendChild(P.el('span', 'iwac-vis-topic-card__id', P.t('Topic') + ' ' + topic.id));
        head.appendChild(P.el(
            'span',
            'iwac-vis-topic-card__count',
            P.t('articles_count', { count: P.formatNumber(topic.article_count) })
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

    function showDetail(container, overview, detail, ctx, topicId) {
        var topic = (ctx.data.topics || []).find(function (t) {
            return t.id === topicId;
        });
        if (!topic) return;

        overview.classList.remove('is-active');
        detail.classList.add('is-active');
        detail.innerHTML = '';

        detail.appendChild(buildDetailHeader(topic, function back() {
            detail.classList.remove('is-active');
            overview.classList.add('is-active');
        }));

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
            calendar:               { cells: topic.day_cells || [] },
            country_distribution:   topic.country_distribution || [],
            newspaper_distribution: topic.newspaper_distribution || [],
            top_articles:           topArticles
        }, {
            siteBase: ctx.siteBase,
            topic:    topic
        });

        // Bring the detail header into view smoothly so the user
        // doesn't have to scroll up after clicking a topic deep
        // in the overview's card grid.
        try {
            detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* old browsers ignore the options bag */ }
    }

    function buildDetailHeader(topic, onBack) {
        var header = P.el('div', 'iwac-vis-topic-detail__header');

        var topRow = P.el('div', 'iwac-vis-topic-detail__row');
        topRow.appendChild(P.el(
            'h3',
            'iwac-vis-topic-detail__title',
            P.t('Topic') + ' ' + topic.id
        ));
        var back = P.el('button', 'iwac-vis-btn iwac-vis-topic-detail__back',
            '← ' + P.t('Back to all topics'));
        back.type = 'button';
        back.addEventListener('click', onBack);
        topRow.appendChild(back);
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

    /* ----------------------------------------------------------------- */
    /*  Boot                                                              */
    /* ----------------------------------------------------------------- */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
