/**
 * Pipeline explainer — the Svelte entry.
 *
 * Bundled ahead of charts/pipeline-explainer.js (asset/js/bundles.json,
 * `blocks.pipeline-explainer.svelte`), it publishes one function on the
 * module namespace: mount the diagram over a block's server-rendered reading.
 * Each block mounts its own instance, so several presets can share a page.
 *
 * The words come from the block's JSON island, written by the template from
 * `PipelinePresets`; this bundle carries drawings and behaviour only.
 */
import { mount } from 'svelte';
import Explainer from './Explainer.svelte';

const ns = window.IWACVis;

ns.mountPipelineExplainer = function (root) {
    if (root.dataset.pipelineReady === 'true') return;
    const island = root.querySelector('.iwac-vis-pipeline__content');
    const reading = root.querySelector('.iwac-vis-pipeline__figure');
    if (!island || !reading) return;
    // A malformed island leaves the server's reading in place, which says
    // everything the diagram would.
    const content = JSON.parse(island.textContent);
    mount(Explainer, {
        target: root,
        anchor: reading,
        props: { content, instance: root.dataset.instance || 'pipeline' },
    });
    reading.remove();
    root.dataset.pipelineReady = 'true';
};
