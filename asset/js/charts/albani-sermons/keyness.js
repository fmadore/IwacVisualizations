/**
 * IWAC Visualizations — Albani Zaria sermons, section 6: keyness.
 *
 * Each recording, each period and each kind of segment against the rest of
 * the corpus, shown as signature cards: the words it uses far more than
 * the others, set in four sizes by how far. By recording every card is on
 * the page at once — the point is to scan the lessons and see their
 * subjects surface — where a picker and a bar chart showed one at a time.
 * By period it is thin (few recordings are dated) and says so; by mode it
 * is the check on what the dialogue segments add.
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

    /** This section's panels (A.claimPanels). */
    var KEY = A.claimPanels('keyness', { cards: 'albani-keyness' });

    var RECORDING_WORDS = 10;
    var SLICE_WORDS = 18;
    var STEPS = 4;

    /**
     * The cards of one facet, in A.recordingOrder for recordings and in
     * their natural order (before → after, monologue → dialogue) otherwise.
     */
    function slices(keyness, facet, metadata) {
        var data = keyness['by_' + facet] || {};
        var period = (keyness.period || {}).split || '';
        var date = P.formatDate ? P.formatDate(period) : period;
        if (facet === 'recording') {
            return A.recordingOrder(metadata).filter(function (r) { return data[r.o]; }).map(function (r) {
                return { key: r.o, title: r.t, year: r.y, rec: r, terms: data[r.o] };
            });
        }
        var keys = facet === 'period' ? ['before', 'after'] : ['monologue', 'exchange'];
        var labels = {
            before: P.t('albani_keyness_before', { date: date }),
            after: P.t('albani_keyness_after', { date: date }),
            monologue: P.t('albani_mode_monologue'),
            exchange: P.t('albani_mode_exchange')
        };
        return keys.filter(function (k) { return data[k]; }).map(function (k) {
            return { key: k, title: labels[k], terms: data[k] };
        });
    }

    /**
     * Size steps by rank within the card, not by the raw ratio: ratios run
     * from ×2 to "only here" (∞), and a linear scale would set one word
     * huge and the rest at the floor.
     */
    function step(i, n) {
        return Math.min(STEPS, Math.floor(i / Math.max(1, n) * STEPS)) + 1;
    }

    function card(slice, max, ctx) {
        var el = P.el('article', 'iwac-vis-albani__sig');
        var head = P.el('h4', 'iwac-vis-albani__sig-title');
        if (slice.rec) {
            var link = P.el('a', 'iwac-vis-albani__sig-link', slice.title);
            link.href = A.itemHref(ctx, slice.rec.o, slice.rec.u);
            head.appendChild(link);
        } else {
            head.textContent = slice.title;
        }
        el.appendChild(head);
        if (slice.year) el.appendChild(P.el('p', 'iwac-vis-albani__sig-year', String(slice.year)));
        var list = P.el('ul', 'iwac-vis-albani__sig-words');
        var terms = slice.terms.slice(0, max);
        terms.forEach(function (term, i) {
            var li = P.el('li', 'iwac-vis-albani__sig-word iwac-vis-albani__sig-word--' + (STEPS + 1 - step(i, terms.length)));
            li.appendChild(P.el('span', 'iwac-vis-albani__hausa', term.w));
            var ratio = term.ratio != null ? '×' + P.formatDecimal(term.ratio, 1) : P.t('albani_keyness_only_here');
            var detail = P.t('albani_keyness_tooltip', {
                count: term.n, segments: P.formatNumber(term.s),
                g2: P.formatNumber(Math.round(term.g2 || 0)) });
            li.title = ratio + ' · ' + detail;
            // The ratio for screen readers, which never see a `title`.
            li.appendChild(P.el('span', 'iwac-vis-albani__sr', ' (' + ratio + ')'));
            list.appendChild(li);
        });
        el.appendChild(list);
        return el;
    }

    A.renderKeyness = function (section, bundle, fetch, ctx) {
        var host = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(host);

        A.lazy(host, function () { return fetch('keyness.json'); }, function (keyness) {
            var facets = [
                { key: 'recording', label: P.t('albani_keyness_by_recording') },
                { key: 'period', label: P.t('albani_keyness_by_period') },
                { key: 'mode', label: P.t('albani_keyness_by_mode') }
            ];
            var state = { facet: 'recording' };
            var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('albani_keyness_cards'), P.t('albani_keyness_cards_desc'), { key: KEY.cards });
            panel.chart.classList.add('iwac-vis-albani__list-host');
            host.appendChild(panel.panel);

            var controls = P.el('div', 'iwac-vis-albani__controls');
            var facetControl = P.buildSegmented({
                name: 'albani-keyness-facet',
                ariaLabel: P.t('albani_keyness_heading'),
                active: state.facet,
                options: facets,
                onChange: function (key) {
                    state.facet = key;
                    refresh();
                }
            });
            controls.appendChild(facetControl.root);
            var caption = P.el('p', 'iwac-vis-panel-desc iwac-vis-albani__caption');
            var empty = A.note(P.t('albani_keyness_none'));
            panel.panel.insertBefore(controls, panel.chart);
            panel.panel.insertBefore(caption, panel.chart);
            panel.panel.insertBefore(empty, panel.chart);

            var grid = P.el('div', 'iwac-vis-albani__sigs');
            panel.chart.appendChild(grid);

            function refresh() {
                var list = slices(keyness, state.facet, bundle.metadata);
                grid.innerHTML = '';
                grid.classList.toggle('iwac-vis-albani__sigs--pair', state.facet !== 'recording');
                var max = state.facet === 'recording' ? RECORDING_WORDS : SLICE_WORDS;
                list.forEach(function (slice) { grid.appendChild(card(slice, max, ctx)); });
                empty.hidden = list.length > 0;

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
            refresh();
        });
    };
})();
