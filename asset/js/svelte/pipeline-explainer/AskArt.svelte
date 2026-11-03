<script>
	// Ask AI, in five drawings: a question and the French terms it is searched
	// as, the server's tool calls, the dataset that answers them, results that
	// come back with their links, and an answer citing them. The tool names
	// are real (iwac-mcp-server's manifest); the question, the titles and the
	// answer are invented.
	let { kind, labels } = $props();

	const TERMS = ['Tabaski', 'Aïd el-Kébir'];
	const CALLS = ['search_index', 'search_articles', 'get_article'];
	const RESULTS = ['La Tabaski à Cotonou', 'Aïd el-Kébir à Porto-Novo', 'Le prix du mouton'];
	/** The answer: [line length, the source it cites, if any]. */
	const ANSWER = [
		[1, 1],
		[0.8, 2],
		[1, 0],
		[0.55, 3]
	];
</script>

{#snippet linkMark()}
	<svg class="iwac-vis-pipeline__link-mark" viewBox="0 0 12 12" width="10" height="10">
		<path d="M5 7 L7 5 M4.5 3.5 L5.5 2.5 a2.1 2.1 0 0 1 3 3 L7.5 6.5 M4.5 5.5 L3.5 6.5 a2.1 2.1 0 0 0 3 3 L7.5 8.5" />
	</svg>
{/snippet}

{#if kind === 'question'}
	<div class="iwac-vis-pipeline__ask">
		<p class="iwac-vis-pipeline__bubble">{labels.question}</p>
		<p class="iwac-vis-pipeline__legend">{labels.searchTerms}</p>
		<p class="iwac-vis-pipeline__ask-terms">
			{#each TERMS as term, j (term)}
				<span class="iwac-vis-pipeline__term iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>{term}</span>
			{/each}
		</p>
	</div>
{:else if kind === 'tools'}
	<div class="iwac-vis-pipeline__sheet iwac-vis-pipeline__sheet--mono">
		{#each CALLS as call, j (call)}
			<p class="iwac-vis-pipeline__call iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>{call}(…)</p>
		{/each}
	</div>
{:else if kind === 'dataset'}
	<!-- The server asks, the dataset answers: one call out, its rows back. -->
	<svg viewBox="0 0 140 96" width="140" height="96">
		<rect class="iwac-vis-pipeline__paper" x="8" y="24" width="38" height="36" rx="2" />
		{#each [0, 1, 2] as k (k)}
			<rect class="iwac-vis-pipeline__stub" x="13" y={30 + k * 10} width="28" height="4" rx="1" />
		{/each}
		<text class="iwac-vis-pipeline__num" x="27" y="74">MCP</text>
		<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="0" pathLength="1" d="M50 37 L80 37 M76 34 L80 37 L76 40" />
		<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="1.5" pathLength="1" d="M80 49 L50 49 M54 46 L50 49 L54 52" />
		<path class="iwac-vis-pipeline__paper" d="M84 20 L84 62 A22 6 0 0 0 128 62 L128 20 Z" />
		<ellipse class="iwac-vis-pipeline__paper" cx="106" cy="20" rx="22" ry="6" />
		<path class="iwac-vis-pipeline__band" d="M84 34 A22 6 0 0 0 128 34 M84 48 A22 6 0 0 0 128 48" />
		<text class="iwac-vis-pipeline__num" x="106" y="84">{labels.dataset}</text>
	</svg>
{:else if kind === 'results'}
	<div class="iwac-vis-pipeline__card">
		{#each RESULTS as title, j (title)}
			<p class="iwac-vis-pipeline__result iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>
				{@render linkMark()}<span class="iwac-vis-pipeline__result-title">{title}</span>
			</p>
		{/each}
		<p class="iwac-vis-pipeline__card-foot iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="3">{labels.version}</p>
	</div>
{:else if kind === 'answer'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.answer}</p>
		{#each ANSWER as [w, source], k (k)}
			<p class="iwac-vis-pipeline__answer-line">
				<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={k * 0.6} style:--iwac-vis-pipeline-w={w}></span>
				{#if source}<span class="iwac-vis-pipeline__cite iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={k * 0.6 + 0.5}>{source}</span>{/if}
			</p>
		{/each}
	</div>
{/if}
