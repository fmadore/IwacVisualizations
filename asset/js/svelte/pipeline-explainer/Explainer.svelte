<script>
	// One IWAC workflow, drawn as its stages in reading order.
	//
	// Adapted from Kalamu's PipelineDiagram: each stage is a list item with its
	// own words, so the drawing beside it is decoration (aria-hidden) and the
	// order survives any layout. The sequence plays once, the first time the
	// diagram scrolls into view, and again on Replay; it never loops. The
	// resting styles ARE the last frame, so before the first play, after every
	// play, under reduced motion and in print the diagram is complete.
	//
	// Stages play one after another across every route, so a reader follows
	// one movement at a time: a second route starts where the first ends.
	// The whole sequence stays under five seconds — five stages 700 ms
	// apart, or a closer stagger for a longer sequence, so the last stage
	// starts by 3.9 s and settles by about 4.5 s — so it needs Replay but no
	// pause control (WCAG 2.2.2).
	import { onMount } from 'svelte';
	import TopicArt from './TopicArt.svelte';
	import OcrArt from './OcrArt.svelte';
	import EntityArt from './EntityArt.svelte';
	import AlbaniArt from './AlbaniArt.svelte';
	import IssueArt from './IssueArt.svelte';
	import AskArt from './AskArt.svelte';
	import SentimentArt from './SentimentArt.svelte';

	let { content, instance } = $props();

	const ART = {
		'topic-modelling': TopicArt,
		ocr: OcrArt,
		'entity-enrichment': EntityArt,
		'albani-sermons': AlbaniArt,
		'issue-contents': IssueArt,
		'ask-ai': AskArt,
		'press-attitudes': SentimentArt
	};
	const Art = $derived(ART[content.preset]);
	const several = $derived(content.routes.length > 1);
	const titleId = $derived(`${instance}-title`);
	/** Where each route's first stage falls in the whole sequence. */
	const offsets = $derived(
		content.routes.map((_, r) => content.routes.slice(0, r).reduce((n, route) => n + route.stages.length, 0))
	);
	/** The last stage starts by 3.9 s, and stages are never closer than the
	 *  stagger a single five-stage route has always had to be. */
	const stagger = $derived(Math.min(700, Math.floor(3900 / Math.max(1, offsets.at(-1) + content.routes.at(-1).stages.length - 1))));

	/** Times the sequence has started: 0 until the diagram is first seen. */
	let runs = $state(0);
	let reduced = $state(false);
	let figure;

	onMount(() => {
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = motion.matches;
		const onMotion = (event) => {
			reduced = event.matches;
		};
		motion.addEventListener('change', onMotion);

		// Plays once its top passes the lower quarter of the viewport, which a
		// diagram taller than the screen (two routes on a phone) still does.
		// Without an observer it simply never plays: the resting diagram is
		// already complete.
		let seen = null;
		if ('IntersectionObserver' in window) {
			seen = new IntersectionObserver(
				(entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return;
					seen.disconnect();
					if (!reduced) runs += 1;
				},
				{ rootMargin: '0px 0px -25% 0px' }
			);
			seen.observe(figure);
		}
		return () => {
			if (seen) seen.disconnect();
			motion.removeEventListener('change', onMotion);
		};
	});
</script>

<figure
	bind:this={figure}
	class="iwac-vis-pipeline__figure iwac-vis-pipeline__figure--drawn"
	class:iwac-vis-pipeline__figure--playing={runs > 0 && !reduced}
	style:--iwac-vis-pipeline-stagger="{stagger}ms"
	data-preset={content.preset}
	aria-labelledby={titleId}
>
	<div class="iwac-vis-pipeline__head">
		<svelte:element this={content.headingLevel} class="iwac-vis-pipeline__title" id={titleId}
			>{content.title}</svelte:element
		>
		{#if !reduced}
			<button type="button" class="iwac-vis-pipeline__replay" onclick={() => (runs += 1)}
				>{content.replay}</button
			>
		{/if}
	</div>
	<p class="iwac-vis-pipeline__lede">{content.lede}</p>
	{#key runs}
		<div class="iwac-vis-pipeline__routes">
			{#each content.routes as route, r (route.id)}
				<section
					class="iwac-vis-pipeline__route"
					aria-labelledby={several ? `${instance}-${route.id}` : undefined}
				>
					{#if several}
						<svelte:element
							this={content.routeHeadingLevel}
							class="iwac-vis-pipeline__route-title"
							id={`${instance}-${route.id}`}>{route.title}</svelte:element
						>
					{/if}
					<ol class="iwac-vis-pipeline__stages">
						{#each route.stages as stage, i (stage.art)}
							<li class="iwac-vis-pipeline__stage" style:--iwac-vis-pipeline-i={offsets[r] + i}>
								<div class="iwac-vis-pipeline__art" aria-hidden="true">
									<Art kind={stage.art} labels={content.labels} />
								</div>
								<p class="iwac-vis-pipeline__name">{stage.name}</p>
								<!-- One cell, so a row of stages lines up its drawings and
								     names while each caption keeps its note close. -->
								<div class="iwac-vis-pipeline__words">
									<p class="iwac-vis-pipeline__caption">{stage.caption}</p>
									{#if stage.note}<p class="iwac-vis-pipeline__note">{stage.note}</p>{/if}
								</div>
							</li>
						{/each}
					</ol>
				</section>
			{/each}
		</div>
	{/key}
	<figcaption class="iwac-vis-pipeline__foot">
		<p class="iwac-vis-pipeline__caveat">{content.caveat}</p>
		<p class="iwac-vis-pipeline__example">{content.example}</p>
	</figcaption>
</figure>
