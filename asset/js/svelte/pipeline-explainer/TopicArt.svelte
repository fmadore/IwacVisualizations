<script>
	// Topic modelling, in five drawings: articles, their words prepared, the
	// counts an article becomes, the topics LDA infers, and each article's mix
	// of them. Sample words, invented proportions: the block says so in its
	// `example` line. `--j` orders the marks inside a stage.
	let { kind, labels } = $props();

	const PREPARE = [
		{ from: 'mosquées', to: 'mosquée' },
		{ from: 'les', to: '' },
		{ from: 'priaient', to: 'prier' },
		{ from: 'Al-Azhar', to: 'al_azhar' }
	];
	const COUNTS = [
		['mosquée', 4],
		['imam', 3],
		['prière', 2],
		['tabaski', 1]
	];
	/** Each topic's three strongest words, with their weight in the topic. */
	const TOPICS = [
		[
			['mosquée', 1],
			['imam', 0.75],
			['prière', 0.55]
		],
		[
			['élection', 1],
			['parti', 0.7],
			['vote', 0.5]
		],
		[
			['école', 1],
			['élève', 0.7],
			['arabe', 0.6]
		]
	];
	/** Three articles' shares of the three topics, in per cent. */
	const MIXTURES = [
		[62, 28, 10],
		[12, 71, 17],
		[35, 8, 57]
	];
</script>

{#if kind === 'articles'}
	<svg viewBox="0 0 140 96" width="140" height="96">
		<rect class="iwac-vis-pipeline__paper" x="54" y="4" width="54" height="74" rx="2" />
		<rect class="iwac-vis-pipeline__paper" x="47" y="9" width="54" height="74" rx="2" />
		<rect class="iwac-vis-pipeline__paper" x="40" y="14" width="54" height="74" rx="2" />
		<rect class="iwac-vis-pipeline__ink" x="45" y="19" width="44" height="4" rx="1" />
		{#each [0, 1] as c (c)}
			{#each { length: 8 } as _, k (k)}
				<rect
					class="iwac-vis-pipeline__print"
					x={45 + c * 23}
					y={28 + k * 7}
					width={k % 4 === 3 ? 12 : 21}
					height="2"
					rx="1"
				/>
			{/each}
		{/each}
	</svg>
{:else if kind === 'prepare'}
	<ul class="iwac-vis-pipeline__tokens">
		{#each PREPARE as row, j (row.from)}
			<li class="iwac-vis-pipeline__token" class:iwac-vis-pipeline__token--dropped={!row.to}>
				<span class="iwac-vis-pipeline__word" style:--iwac-vis-pipeline-j={j}>{row.from}</span>
				{#if row.to}
					<span class="iwac-vis-pipeline__becomes">→</span>
					<span class="iwac-vis-pipeline__lemma iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>{row.to}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else if kind === 'counts'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.article} 1</p>
		<ul class="iwac-vis-pipeline__counts">
			{#each COUNTS as [word, n], j (word)}
				<li class="iwac-vis-pipeline__count">
					<span class="iwac-vis-pipeline__count-word">{word}</span>
					<span class="iwac-vis-pipeline__bar iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={j} style:--iwac-vis-pipeline-w={n / 4}
					></span>
					<span class="iwac-vis-pipeline__count-n">{n}</span>
				</li>
			{/each}
		</ul>
	</div>
{:else if kind === 'topics'}
	<ul class="iwac-vis-pipeline__topics">
		{#each TOPICS as words, t (t)}
			<li class="iwac-vis-pipeline__topic iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={t}>
				<span class="iwac-vis-pipeline__swatch" data-series={t + 1}>{t + 1}</span>
				<span class="iwac-vis-pipeline__topic-words">
					{#each words as [word, weight] (word)}
						<span class="iwac-vis-pipeline__topic-word" style:--iwac-vis-pipeline-w={weight}>{word}</span>
					{/each}
				</span>
			</li>
		{/each}
	</ul>
{:else if kind === 'mixtures'}
	<!-- The legend names each colour, so no share is told by colour alone. -->
	<div class="iwac-vis-pipeline__mixtures">
		<p class="iwac-vis-pipeline__legend">
			{labels.topic}
			{#each [1, 2, 3] as t (t)}<span class="iwac-vis-pipeline__swatch" data-series={t}>{t}</span>{/each}
		</p>
		{#each MIXTURES as shares, a (a)}
			<p class="iwac-vis-pipeline__mixture-label">{labels.article} {a + 1}</p>
			<span class="iwac-vis-pipeline__mixture-bar">
				{#each shares as share, t (t)}
					<span
						class="iwac-vis-pipeline__segment iwac-vis-pipeline__grow"
						data-series={t + 1}
						style:flex-basis="{share}%"
						style:--iwac-vis-pipeline-j={a + t * 0.3}
					></span>
				{/each}
			</span>
		{/each}
	</div>
{/if}
