/**
 * IWAC Visualizations — Horizontal bar renderer
 *
 * Layout-system wrapper around `IWACVis.chartOptions.horizontalBar`.
 * Used by any layout slot that wants a generic top-N horizontal bar
 * without writing a bespoke renderer per chart key.
 *
 * Data shape — plain array of `{name, value}` objects, or a keyed
 * `{key: count, …}` map. The renderer routes both through
 * `ns.toEntries` so callers don't have to normalize beforehand.
 *
 * **`valueKey` defaults to `value` here, and that is the whole point of
 * this file's existence.** `C.horizontalBar` defaults it to `count`,
 * because its direct callers hand it `{name, count}`. This renderer's
 * contract is the other one: `ns.toEntries` emits `{name, value}` for a
 * keyed map, and the generators that feed layout slots emit the same.
 * Handing the second shape to the first default resolves every value to
 * `undefined`, which is not an error anywhere — the category axis still
 * draws its labels, the value axis simply has no range, and the panel
 * renders a full set of country names with no bars beside them. That is
 * what Topic Explorer's "Top countries" and "Top newspapers" did for as
 * long as this renderer has existed. A slot that really does carry
 * `{name, count}` passes `valueKey: 'count'` and says so.
 *
 * Slot options (`slot.options`) pass through to `C.horizontalBar`, which
 * reads `nameKey`, `valueKey`, `filterUnknown`, `log`, `valueFormatter`,
 * `tooltipFormatter` and `useCountryColors` — and nothing else. `maxBars`
 * is honoured here instead, because a top-N cap is a layout decision and
 * the builder has no opinion on it.
 *
 * Registered as `horizontalBar`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.horizontal-bar: dashboard-layout.js + panels.js must load first');
        return;
    }

    DL.registerRenderer('horizontalBar', function (el, data, slot) {
        if (!ns.chartOptions || typeof ns.chartOptions.horizontalBar !== 'function') {
            console.warn('IWACVis.horizontal-bar renderer: chart-options.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var entries = ns.toEntries ? ns.toEntries(data) : (Array.isArray(data) ? data : []);
        if (!entries.length) {
            el.appendChild(P.buildEmptyState());
            return;
        }

        var slotOpts = (slot && slot.options) || {};
        var opts = { valueKey: 'value' };
        for (var k in slotOpts) {
            if (Object.prototype.hasOwnProperty.call(slotOpts, k)) opts[k] = slotOpts[k];
        }

        // A top-N cap belongs to the slot, not the builder. Entries arrive
        // pre-sorted by the generator, so this is a slice rather than a sort.
        if (slotOpts.maxBars > 0) entries = entries.slice(0, slotOpts.maxBars);

        // The failure this renderer shipped with was silent: a key mismatch
        // paints axis labels and no bars, and nothing anywhere errors. Say so
        // rather than leaving the next person to read it off a screenshot.
        var resolved = entries.filter(function (e) {
            return e && e[opts.valueKey] != null;
        }).length;
        if (!resolved) {
            console.warn('IWACVis.horizontal-bar renderer: no entry carries "' +
                opts.valueKey + '" — available keys: ' +
                Object.keys(entries[0] || {}).join(', ') +
                '. Set slot.options.valueKey. Rendering would be axis labels with no bars.');
        }

        var option = ns.chartOptions.horizontalBar(entries, opts);
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('horizontalBar', {
        labelKey: 'Top values',
        descKey:  'desc_horizontal_bar',
        hasData:  function (v) {
            if (!v) return false;
            if (Array.isArray(v))     return v.length > 0;
            if (typeof v === 'object') return Object.keys(v).length > 0;
            return false;
        }
    });
})();
