<script>
	// The collection in chapters, in reading order: each a heading, a
	// sentence or two, a display numeral and one figure.
	//
	// Each chapter plays once, the first time it scrolls into view, and again
	// on Replay; nothing loops and nothing is pinned. The resting styles ARE
	// the last frame, so before a chapter plays, after it has played, under
	// reduced motion and in print the introduction is complete. Every
	// chapter's motion ends within two seconds, so it needs Replay but no
	// pause control.
	//
	// A chapter whose data is missing keeps its words and draws no figure —
	// except an `optional` one (the bibliography), which is left out whole,
	// so a data file from before its section still reads complete.
	import { onMount } from 'svelte';
	import Count from './Count.svelte';
	import TypesPlate from './TypesPlate.svelte';
	import MapPlate from './MapPlate.svelte';
	import YearsPlate from './YearsPlate.svelte';
	import VoicesPlate from './VoicesPlate.svelte';
	import ReferencesPlate from './ReferencesPlate.svelte';

	let { content, model, fmt, siteBase, instance } = $props();

	const PLATES = { what: TypesPlate, where: MapPlate, when: YearsPlate, voices: VoicesPlate, references: ReferencesPlate };
	const labels = $derived(content.labels);
	const titleId = $derived(`${instance}-title`);
	const number = (n) => fmt.number(n);
	const chapters = $derived(content.chapters.filter((chapter) => !chapter.optional || model[chapter.id]));
	const drawn = $derived(chapters.some((chapter) => model[chapter.id]));
	const asOf = $derived(
		model.asOf
			? labels.asOf.replace('{date}', fmt.date(model.asOf, { year: 'numeric', month: 'long', day: 'numeric' }))
			: ''
	);

	/** Times each chapter has started playing: 0 until it is first seen. */
	let runs = $state({ what: 0, where: 0, when: 0, voices: 0, references: 0 });
	let reduced = $state(false);
	const chapterEls = {};
	const visible = {};
	const pending = {};

	function play(id) {
		pending[id] = false;
		if (!reduced) runs[id] += 1;
	}

	function replay() {
		for (const chapter of chapters) {
			pending[chapter.id] = true;
			if (visible[chapter.id]) play(chapter.id);
		}
	}

	onMount(() => {
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduced = motion.matches;
		const onMotion = (event) => {
			reduced = event.matches;
		};
		motion.addEventListener('change', onMotion);

		// A chapter plays once its top passes the lower quarter of the
		// viewport. Without an observer it never plays: the resting
		// introduction is already complete.
		let seen = null;
		if ('IntersectionObserver' in window) {
			seen = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						const id = entry.target.dataset.chapter;
						visible[id] = entry.isIntersecting;
						if (entry.isIntersecting && pending[id]) play(id);
					}
				},
				{ rootMargin: '0px 0px -25% 0px' }
			);
			for (const chapter of chapters) {
				if (!model[chapter.id] || !chapterEls[chapter.id]) continue;
				pending[chapter.id] = true;
				seen.observe(chapterEls[chapter.id]);
			}
		}
		return () => {
			if (seen) seen.disconnect();
			motion.removeEventListener('change', onMotion);
		};
	});
</script>

<section class="iwac-vis-intro__figure iwac-vis-intro__figure--drawn" aria-labelledby={titleId}>
	<div class="iwac-vis-intro__head">
		<svelte:element this={content.headingLevel} class="iwac-vis-intro__title" id={titleId}
			>{content.title}</svelte:element
		>
		{#if drawn && !reduced}
			<button type="button" class="iwac-vis-intro__replay" onclick={replay}>{content.replay}</button>
		{/if}
	</div>
	<p class="iwac-vis-intro__lede">{content.lede}</p>
	<div class="iwac-vis-intro__chapters">
		{#each chapters as chapter (chapter.id)}
			{@const data = model[chapter.id]}
			{@const Plate = PLATES[chapter.id]}
			<div
				bind:this={chapterEls[chapter.id]}
				class="iwac-vis-intro__chapter"
				class:iwac-vis-intro__chapter--drawn={data}
				class:iwac-vis-intro__chapter--playing={data && runs[chapter.id] > 0 && !reduced}
				data-chapter={chapter.id}
			>
				<div class="iwac-vis-intro__text">
					<svelte:element this={content.chapterHeadingLevel} class="iwac-vis-intro__heading"
						>{chapter.heading}</svelte:element
					>
					<p class="iwac-vis-intro__sentence">{chapter.text}</p>
					{#if data && chapter.id === 'what'}
						<p class="iwac-vis-intro__numeral iwac-vis-intro__numeral--featured">
							<span class="iwac-vis-intro__value"
								><Count value={data.total} run={runs.what} {reduced} format={number} /></span
							>
							<span class="iwac-vis-intro__unit">{labels.items}</span>
						</p>
						{#if data.secondary.length}
							<dl class="iwac-vis-intro__seconds">
								{#each data.secondary as figure (figure.key)}
									<div class="iwac-vis-intro__second">
										<dt>{labels[figure.key]}</dt>
										<dd><Count value={figure.value} run={runs.what} {reduced} format={number} /></dd>
									</div>
								{/each}
							</dl>
						{/if}
					{:else if data && chapter.id === 'where'}
						<p class="iwac-vis-intro__numeral">
							<span class="iwac-vis-intro__value"
								><Count value={data.count} run={runs.where} {reduced} format={number} duration={600} /></span
							>
							<span class="iwac-vis-intro__unit">{labels.countries}</span>
						</p>
					{:else if data && chapter.id === 'when'}
						<p class="iwac-vis-intro__numeral">
							<span class="iwac-vis-intro__value">{data.first}–{data.last}</span>
							<span class="iwac-vis-intro__unit">{labels.span}</span>
						</p>
						{#if data.newspapers}
							<dl class="iwac-vis-intro__seconds">
								<div class="iwac-vis-intro__second">
									<dt>{labels.newspapers}</dt>
									<dd><Count value={data.newspapers} run={runs.when} {reduced} format={number} /></dd>
								</div>
							</dl>
						{/if}
					{:else if data && chapter.id === 'voices' && data.count}
						<p class="iwac-vis-intro__numeral">
							<span class="iwac-vis-intro__value"
								><Count value={data.count} run={runs.voices} {reduced} format={number} duration={600} /></span
							>
							<span class="iwac-vis-intro__unit">{labels.languages}</span>
						</p>
					{:else if data && chapter.id === 'references'}
						<p class="iwac-vis-intro__numeral">
							<span class="iwac-vis-intro__value"
								><Count value={data.total} run={runs.references} {reduced} format={number} /></span
							>
							<span class="iwac-vis-intro__unit">{labels.references}</span>
						</p>
						{#if data.authors}
							<dl class="iwac-vis-intro__seconds">
								<div class="iwac-vis-intro__second">
									<dt>{labels.authors}</dt>
									<dd><Count value={data.authors} run={runs.references} {reduced} format={number} /></dd>
								</div>
							</dl>
						{/if}
					{/if}
				</div>
				{#if data}
					{#key runs[chapter.id]}
						<div class="iwac-vis-intro__plate">
							<Plate {data} {labels} {fmt} {siteBase} />
						</div>
					{/key}
				{/if}
			</div>
		{/each}
	</div>
	{#if asOf}
		<p class="iwac-vis-intro__foot">{asOf}</p>
	{/if}
</section>
