/** Enhance the server's reading view; the published JSON was read once in PHP. */
(function () {
    'use strict';
    var ns = window.IWACVis;
    ns.panels.bootBlock({
        selector: '.iwac-vis-timeline',
        requireECharts: false,
        clearOnError: false,
        load: function () { return Promise.resolve(null); },
        render: function (root) { ns.enhanceTimeline(root); }
    });
}());
