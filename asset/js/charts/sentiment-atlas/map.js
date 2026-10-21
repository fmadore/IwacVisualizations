/**
 * IWAC Visualizations — Sentiment Atlas block: places map panel
 *
 * The geocoded places tagged on the rated articles as bubbles: the size is
 * how many articles carry the tag, the colour the selected model's mean
 * rating of them on the selected dimension, stepped into the dimension's
 * five grades. A place with fewer rated articles than the bundle's
 * `min_rated` is drawn neutral — one article's rating is not a place's tone.
 *
 * A bubble counts MENTIONS, not aboutness: `spatial` is item-level tagging
 * (several places per article), so a capital's bubble includes every
 * article that names it in passing. "Non applicable" is left out of the
 * polarity mean, but the article still counts towards the size.
 *
 * Data: `sentiment-atlas-places.json`, the generator's sidecar, fetched
 * when the panel nears the viewport (with MapLibre, which the loader
 * imports in parallel with the script chain). Built on the shared
 * P.createFilteredPlacesMap, whose `value` + `colorSteps` colour each
 * bubble by its own mean.
 *
 * Load order: after scales.js; needs the shared map bundle.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    var S = ns && ns.sentimentAtlas;
    if (!S || !S.categories) {
        console.warn('IWACVis sentiment atlas map: scales.js must load first');
        return;
    }
    var P = ns.panels;

    var SOURCE_ID = 'iwac-sentiment-places';
    var LAYER_ID = 'iwac-sentiment-places-bubbles';

    // The neutral fill for a place under the rating threshold.
    var NEUTRAL_VAR = '--iwac-vis-sent-na';

    function neutralColor() {
        return (ns.resolveCssVar && ns.resolveCssVar(NEUTRAL_VAR)) || '';
    }

    function statsFor(bundle, model, dim, idx) {
        var block = (((bundle.models || {})[model]) || {})[dim] || {};
        return { n: (block.n || [])[idx] || 0, mean: (block.mean || [])[idx] };
    }

    /**
     * The legend: the five grades on the ramp, then the neutral swatch.
     * Painted from the tokens themselves (`var(--…)`), not resolved
     * colours, so the light/dark swap repaints it with the page.
     */
    function paintKey(key, dim, minRated) {
        key.innerHTML = '';
        var vars = S.paletteVars(dim);
        S.meanScale(dim).steps.forEach(function (step) {
            key.appendChild(keyItem('var(' + vars[step[1]] + ')', S.label(step[1])));
        });
        key.appendChild(keyItem('var(' + NEUTRAL_VAR + ')', P.t('sentiment.map_too_few', { count: minRated })));
    }

    function keyItem(color, text) {
        var item = P.el('li', 'iwac-vis-key__item');
        var swatch = P.el('span', 'iwac-vis-key__swatch');
        swatch.style.background = color;
        swatch.setAttribute('aria-hidden', 'true');
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(text));
        return item;
    }

    /**
     * Mount the map into a panel. Returns a controller whose `update()`
     * repaints for the current model / dimension (read through `getState`
     * on every call); safe to call before the data or MapLibre arrive.
     *
     * @param {Object} panelEl  P.buildPanel result
     * @param {Object} cfg  {url, siteBase, getState: () => {model, dim}}
     */
    S.mountPlacesMap = function (panelEl, cfg) {
        var bundle = null;
        var controller = null;
        var key = P.el('ul', 'iwac-vis-key');
        key.setAttribute('aria-label', P.t('sentiment.map_key'));
        panelEl.panel.insertBefore(key, panelEl.chart);

        function minRated() {
            return (bundle && bundle.min_rated) || 5;
        }

        function placeIndex(place) {
            return place.__idx;
        }

        // The `<details>` list — the data path for screen readers and a
        // browser without WebGL. It ranks by mentions, which no facet
        // changes, so it is built once.
        function appendDetails() {
            var details = P.buildRankedPlacesDetails({
                places: bundle.places || [],
                count: function (p) { return p.n || 0; },
                summary: P.t('sentiment.map_list'),
                placeLabel: P.t('Place'),
                countLabel: P.t('Articles')
            });
            if (details) panelEl.panel.appendChild(details);
        }

        function build() {
            var places = (bundle.places || []).map(function (p, i) {
                return Object.assign({ __idx: i }, p);
            });
            // The sized host the map stylesheet expects inside the chart
            // slot (`.iwac-vis-chart > .iwac-vis-map`, which fullscreen
            // stretches with it).
            var mapEl = P.el('div', 'iwac-vis-map');
            panelEl.chart.appendChild(mapEl);
            controller = P.createFilteredPlacesMap(mapEl, {
                title: P.t('sentiment.map_name'),
                places: places,
                sourceId: SOURCE_ID,
                layerId: LAYER_ID,
                count: function (place) { return place.n || 0; },
                value: function (place) {
                    var st = cfg.getState();
                    var stats = statsFor(bundle, st.model, st.dim, placeIndex(place));
                    return stats.n >= minRated() ? stats.mean : null;
                },
                colorSteps: function () {
                    var dim = cfg.getState().dim;
                    var palette = S.palette(dim);
                    return {
                        fallback: neutralColor(),
                        stops: S.meanScale(dim).steps.map(function (step) {
                            return [step[0], palette[step[1]]];
                        })
                    };
                },
                siteBase: cfg.siteBase || '',
                popupLines: function (place) {
                    var st = cfg.getState();
                    var stats = statsFor(bundle, st.model, st.dim, placeIndex(place));
                    var lines = [P.t('sentiment.map_mentions', { count: place.n || 0 })];
                    lines.push(stats.n
                        ? P.t('sentiment.map_mean', {
                            dimension: S.dimensionLabel(st.dim),
                            mean: S.formatMean(st.dim, stats.mean),
                            count: stats.n
                        })
                        : P.t('sentiment.map_unrated'));
                    return lines;
                }
            });
        }

        P.lazyInit(panelEl.panel, function () {
            P.fetchJSON(cfg.url)
                .then(function (data) {
                    bundle = data || {};
                    if (!(bundle.places || []).length) {
                        panelEl.chart.appendChild(P.buildEmptyState());
                        return;
                    }
                    paintKey(key, cfg.getState().dim, minRated());
                    build();
                    appendDetails();
                })
                .catch(function (err) {
                    console.error('IWACVis sentiment atlas map:', err);
                    panelEl.chart.appendChild(P.buildFetchErrorState(err));
                });
        });

        return {
            update: function () {
                if (!bundle) return;
                paintKey(key, cfg.getState().dim, minRated());
                if (controller) controller.update();
            }
        };
    };
})();
