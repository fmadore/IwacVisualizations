/**
 * Collection Introduction — the Svelte entry.
 *
 * Bundled ahead of charts/collection-intro.js (asset/js/bundles.json,
 * `blocks.collection-intro.svelte`), it publishes one function on the module
 * namespace: mount the introduction over a block's server-rendered reading,
 * once the orchestrator has fetched the data.
 *
 * The words come from the block's JSON island, written by the template from
 * `CollectionIntroText`; the numbers from `collection-overview.json`, read by
 * model.js. This bundle carries drawings and behaviour only.
 */
import { mount } from 'svelte';
import Intro from './Intro.svelte';
import { buildModel } from './model.js';

const ns = window.IWACVis;

ns.mountCollectionIntro = function (root, { data, geo, siteBase, format }) {
    if (root.dataset.introReady === 'true') return;
    const island = root.querySelector('.iwac-vis-intro__content');
    const reading = root.querySelector('.iwac-vis-intro__figure');
    if (!island || !reading) return;
    // A malformed island, or data with no figure in it, leaves the server's
    // reading in place: it says everything but the numbers.
    const content = JSON.parse(island.textContent);
    const model = buildModel(data, geo);
    if (!model.what && !model.where && !model.when && !model.voices && !model.references) return;
    mount(Intro, {
        target: root,
        anchor: reading,
        props: { content, model, fmt: format, siteBase: siteBase || '', instance: root.dataset.instance || 'collection-intro' },
    });
    reading.remove();
    root.dataset.introReady = 'true';
};
