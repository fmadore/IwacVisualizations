/**
 * IWAC Visualizations — Sentiment Atlas block: rating scales + statistics
 *
 * What the comparison, trend, ranking and map panels share: the three rated
 * dimensions, their categories in the bundle's order and in reading order,
 * the semantic ramp each one paints from, Landis & Koch's kappa bands, and
 * Spearman's rho from a cross-tab of counts. Pure functions over the
 * payload, so the panels stay small and tests can run them in a VM.
 *
 * Load order: after sentiment-atlas/i18n.js, before the panel files.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis sentiment atlas scales: missing panels or chartOptions');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;
    var S = ns.sentimentAtlas = ns.sentimentAtlas || {};

    S.NOT_APPLICABLE = 'Non applicable';
    S.DIMENSIONS = ['polarity', 'centrality', 'subjectivity'];

    /** The axis title for a dimension, from the shared dictionary. */
    S.dimensionLabel = function (dim) {
        return P.t(dim === 'polarity' ? 'Polarity' : dim === 'centrality' ? 'Centrality' : 'Subjectivity');
    };

    /**
     * A dimension's categories in the BUNDLE's order — the order its
     * cross-tabs and `distribution` counts are written in: polarity most
     * positive first with "Non applicable" last, centralité most central
     * first, subjectivité 1..5.
     */
    S.categories = function (data, dim) {
        var rel = (data.reliability || {})[dim];
        if (rel && rel.labels) return rel.labels.slice();
        if (dim === 'polarity') return (data.polarity_order || []).slice();
        if (dim === 'centrality') return (data.centrality_order || []).slice();
        return (data.subjectivity_levels || [1, 2, 3, 4, 5]).map(String);
    };

    /**
     * The same categories in READING order, low to high, for a bar a reader
     * scans left to right: most negative → most positive (with "Non
     * applicable" after the scale, where it is no grade at all), not
     * addressed → very central, 1 → 5.
     */
    S.readingOrder = function (data, dim) {
        var cats = S.categories(data, dim);
        if (dim === 'subjectivity') return cats;
        var graded = cats.filter(function (c) { return c !== S.NOT_APPLICABLE; }).reverse();
        return cats.indexOf(S.NOT_APPLICABLE) >= 0 ? graded.concat([S.NOT_APPLICABLE]) : graded;
    };

    /** Raw category → colour on the dimension's semantic ramp. */
    S.palette = function (dim) {
        if (dim === 'polarity') return C.polarityPalette();
        if (dim === 'centrality') return C.centralityPalette();
        return C.subjectivityPalette();
    };

    /**
     * Raw category → the token behind its colour, for HTML swatches that
     * should follow the light/dark swap by themselves (`var(--…)`). The
     * same mapping C.polarityPalette & co. resolve for the canvas.
     */
    S.paletteVars = function (dim) {
        if (dim === 'polarity') {
            return {
                'Très positif': '--iwac-vis-sent-pos-strong', 'Positif': '--iwac-vis-sent-pos',
                'Neutre': '--iwac-vis-sent-neutral', 'Négatif': '--iwac-vis-sent-neg',
                'Très négatif': '--iwac-vis-sent-neg-strong', 'Non applicable': '--iwac-vis-sent-na'
            };
        }
        if (dim === 'centrality') {
            return {
                'Très central': '--iwac-vis-cent-1', 'Central': '--iwac-vis-cent-2',
                'Secondaire': '--iwac-vis-cent-3', 'Marginal': '--iwac-vis-cent-4',
                'Non abordé': '--iwac-vis-cent-na'
            };
        }
        return {
            '1': '--iwac-vis-subj-1', '2': '--iwac-vis-subj-2', '3': '--iwac-vis-subj-3',
            '4': '--iwac-vis-subj-4', '5': '--iwac-vis-subj-5'
        };
    };

    /** Display label of a raw category ('Très positif', 'Non abordé', '3'). */
    S.label = function (key) {
        return P.t(String(key));
    };

    /**
     * The ordinal scale the ranking and the map report a mean on: polarity
     * as the net index −2..+2, the other two 1..5. `neutral` is where the
     * reference line goes; `steps` are the five grades' lower bounds and
     * raw category keys, lowest first, for a colour step over a mean.
     */
    S.meanScale = function (dim) {
        if (dim === 'polarity') {
            return {
                min: -2, max: 2, neutral: 0,
                steps: [
                    [-2.5, 'Très négatif'], [-1.5, 'Négatif'], [-0.5, 'Neutre'],
                    [0.5, 'Positif'], [1.5, 'Très positif']
                ]
            };
        }
        if (dim === 'centrality') {
            return {
                min: 1, max: 5, neutral: 3,
                steps: [
                    [0.5, 'Non abordé'], [1.5, 'Marginal'], [2.5, 'Secondaire'],
                    [3.5, 'Central'], [4.5, 'Très central']
                ]
            };
        }
        return {
            min: 1, max: 5, neutral: 3,
            steps: [[0.5, '1'], [1.5, '2'], [2.5, '3'], [3.5, '4'], [4.5, '5']]
        };
    };

    /** A mean on its scale as text: polarity signed (+0.42), the rest plain. */
    S.formatMean = function (dim, value) {
        if (value == null || !isFinite(value)) return '—';
        var text = P.formatNumber(Math.round(value * 100) / 100);
        return dim === 'polarity' && value > 0 ? '+' + text : text;
    };

    /**
     * Landis & Koch's (1977) verbal band for a kappa — their conventional
     * labels, not a test: the same kappa reads differently with skewed
     * marginals. Null when the kappa is undefined.
     */
    S.kappaBand = function (kappa) {
        if (kappa == null || !isFinite(kappa)) return null;
        if (kappa < 0) return 'poor';
        if (kappa <= 0.2) return 'slight';
        if (kappa <= 0.4) return 'fair';
        if (kappa <= 0.6) return 'moderate';
        if (kappa <= 0.8) return 'substantial';
        return 'almost_perfect';
    };

    /** erfc(x) for x ≥ 0 — Abramowitz & Stegun 7.1.26, |error| < 1.5e-7. */
    function erfc(x) {
        var t = 1 / (1 + 0.3275911 * x);
        var poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
            + t * (-1.453152027 + t * 1.061405429))));
        return poly * Math.exp(-x * x);
    }

    /**
     * Spearman's rho from a two-way table of counts over two ordinal
     * scales, rows and columns each in scale order. Ties take midranks
     * (every article in one cell shares a rank pair), so this equals rho
     * over the expanded per-article ranks.
     *
     * The p-value is two-sided, from t = rho·√((n−2)/(1−rho²)) under the
     * normal approximation — exact enough at the atlas's thousands of
     * articles, and not reported below 30.
     *
     * @param {Array<Array<number>>} table  table[i][j] = articles at row
     *   grade i and column grade j
     * @returns {{rho: number|null, n: number, p: number|null}}
     */
    S.spearmanFromTable = function (table) {
        var rows = table || [];
        var nRows = rows.length;
        var nCols = nRows ? rows[0].length : 0;
        var rowTotals = [];
        var colTotals = [];
        var n = 0;
        var i, j;
        for (j = 0; j < nCols; j++) colTotals.push(0);
        for (i = 0; i < nRows; i++) {
            var rt = 0;
            for (j = 0; j < nCols; j++) {
                var c = rows[i][j] || 0;
                rt += c;
                colTotals[j] += c;
            }
            rowTotals.push(rt);
            n += rt;
        }
        if (n < 3) return { rho: null, n: n, p: null };

        function midranks(totals) {
            var out = [];
            var before = 0;
            totals.forEach(function (t) {
                out.push(before + (t + 1) / 2);
                before += t;
            });
            return out;
        }
        var xr = midranks(rowTotals);
        var yr = midranks(colTotals);
        var mean = (n + 1) / 2;
        var sxy = 0, sxx = 0, syy = 0;
        for (i = 0; i < nRows; i++) {
            sxx += rowTotals[i] * (xr[i] - mean) * (xr[i] - mean);
            for (j = 0; j < nCols; j++) {
                sxy += (rows[i][j] || 0) * (xr[i] - mean) * (yr[j] - mean);
            }
        }
        for (j = 0; j < nCols; j++) syy += colTotals[j] * (yr[j] - mean) * (yr[j] - mean);
        if (!sxx || !syy) return { rho: null, n: n, p: null };
        var rho = sxy / Math.sqrt(sxx * syy);
        var p = null;
        if (n >= 30) {
            p = Math.abs(rho) >= 1 ? 0 : erfc(Math.abs(rho * Math.sqrt((n - 2) / (1 - rho * rho))) / Math.SQRT2);
        }
        return { rho: rho, n: n, p: p };
    };

    /** Spearman's rho in words: Cohen's conventional strength bands. */
    S.rhoBand = function (rho) {
        if (rho == null) return null;
        var a = Math.abs(rho);
        if (a < 0.1) return 'negligible';
        if (a < 0.3) return 'weak';
        if (a < 0.5) return 'moderate';
        return 'strong';
    };
})();
