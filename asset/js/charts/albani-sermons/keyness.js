/**
 * IWAC Visualizations — Albani Zaria sermons, section 6: keyness.
 *
 * Each recording, each period and each kind of segment against the rest of
 * the corpus. By recording it is where a lesson's subject shows through its
 * vocabulary; by period it is thin (few recordings are dated) and says so;
 * by mode it is the check on what the exchange segments add.
 *
 * Bundle: keyness.json, fetched when the section nears the viewport.
 *
 * Depends on: albani-sermons/helpers.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var A = ns.albaniSermons;

    function sliceOptions(keyness, facet, titles) {
        var period = (keyness.period || {}).split || '';
        var date = P.formatDate ? P.formatDate(period) : period;
        var data = keyness['by_' + facet] || {};
        var keys = Object.keys(data);
        if (facet === 'recording') {
            keys.sort(function (a, b) {
                return String((titles[a] || {}).t || a).localeCompare(String((titles[b] || {}).t || b));
            });
            return keys.map(function (k) { return { value: k, label: (titles[k] || {}).t || k }; });
        }
        if (facet === 'period') {
            return ['before', 'after'].filter(function (k) { return data[k]; }).map(function (k) {
                return { value: k, label: P.t(k === 'before' ? 'albani_keyness_before' : 'albani_keyness_after',
                    { date: date }) };
            });
        }
        return ['monologue', 'exchange'].filter(function (k) { return data[k]; }).map(function (k) {
            return { value: k, label: P.t(k === 'monologue' ? 'albani_scope_monologue' : 'albani_kwic_exchange') };
        });
    }

    A.renderKeyness = function (section, bundle, fetch) {
        var titles = A.recordingsById(bundle.metadata);
        var host = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(host);

        A.lazy(host, function () { return fetch('keyness.json'); }, function (keyness) {
            var facets = [
                { key: 'recording', label: P.t('albani_keyness_by_recording') },
                { key: 'period', label: P.t('albani_keyness_by_period') },
                { key: 'mode', label: P.t('albani_keyness_by_mode') }
            ];
            var state = { facet: 'recording', slice: null };
            var caption = P.el('p', 'iwac-vis-panel-desc iwac-vis-albani__caption');
            var empty = A.note(P.t('albani_keyness_none'));
            empty.hidden = true;
            var controls = P.el('div', 'iwac-vis-albani__controls');
            var facetControl = P.buildSegmented({
                name: 'albani-keyness-facet',
                ariaLabel: P.t('albani_keyness_heading'),
                active: state.facet,
                options: facets,
                onChange: function (key) {
                    state.facet = key;
                    state.slice = null;
                    rebuildPicker();
                    panel.redraw();
                }
            });
            controls.appendChild(facetControl.root);
            var pickerHost = P.el('div', 'iwac-vis-albani__picker');
            controls.appendChild(pickerHost);

            function rebuildPicker() {
                pickerHost.innerHTML = '';
                var options = sliceOptions(keyness, state.facet, titles);
                if (!state.slice && options.length) state.slice = options[0].value;
                if (options.length) {
                    pickerHost.appendChild(A.select(P.t('albani_keyness_slice'), options, state.slice,
                        function (value) { state.slice = value; panel.redraw(); },
                        'albani-keyness-slice'));
                }
                var period = keyness.period || {};
                var date = P.formatDate ? P.formatDate(period.split || '') : period.split;
                if (state.facet === 'period') {
                    caption.textContent = period.tested
                        ? P.t('albani_keyness_period_desc', {
                            before: P.formatNumber(((period.recordings || {}).before || []).length),
                            after: P.formatNumber(((period.recordings || {}).after || []).length),
                            undated: P.formatNumber((period.undated || []).length) })
                        : P.t('albani_keyness_period_untested', { date: date });
                    caption.hidden = false;
                } else {
                    caption.hidden = true;
                }
            }

            var panel = A.chartPanel(host, P.t('albani_keyness_heading'), null, function (built) {
                var terms = (((keyness['by_' + state.facet] || {})[state.slice]) || []).slice(0, 25);
                empty.hidden = terms.length > 0;
                if (!terms.length) return null;
                A.sizeFor(built.chart, terms.length);
                return A.logRatioOption(terms, {
                    axis: P.t('albani_keyness_axis'),
                    tooltip: function (term) {
                        return P.t('albani_keyness_tooltip', {
                            count: term.n, segments: P.formatNumber(term.s),
                            g2: P.formatNumber(Math.round(term.g2 || 0)) });
                    }
                });
            }, { wide: true, key: 'albani-keyness', before: [controls, caption, empty] });
            rebuildPicker();
            panel.redraw();
        });
    };
})();
