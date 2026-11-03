/**
 * Pipeline explainer — orchestrator.
 *
 * The block arrives complete: the server renders its whole reading (see
 * view/common/block-layout/pipeline-explainer.phtml). This only waits for the
 * block to near the viewport and hands it to the Svelte diagram, which the
 * same bundle defines first (asset/js/svelte/pipeline-explainer/index.js).
 * Nothing is fetched, so there is no error state to draw: if the diagram
 * cannot mount, the server's reading stays.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    ns.panels.bootBlock({
        selector: '.iwac-vis-pipeline',
        requireECharts: false,
        clearOnError: false,
        warnLabel: 'IWACVis pipeline explainer',
        load: function () { return Promise.resolve(null); },
        onError: function (root, err) { console.error('IWACVis pipeline explainer:', err); },
        render: function (root) { ns.mountPipelineExplainer(root); }
    });
}());
