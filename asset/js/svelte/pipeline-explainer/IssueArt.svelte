<script>
	// Tables of contents for Islamic publications, in five drawings: an issue
	// split into its pages, the article a model finds on one page, a
	// continuation marker sending it on to a later page, the two parts merged
	// into one entry, and the issue's table of contents. One invented article,
	// "Le sens du Hajj" on pages 3 and 7, runs through all five; the issue,
	// its titles and its pages are invented.
	let { kind, labels } = $props();

	/** The pages the issue is split into, after its cover. */
	const PAGES = [52, 80, 108];
	const TITLE = 'Le sens du Hajj';
	/** The finished index: [pages, title as printed, with its section]. */
	const CONTENTS = [
		['p. 2', 'Éditorial'],
		['p. 3, 7', `[Tribune] ${TITLE}`],
		['p. 4–6', 'Le jeûne du Ramadan'],
		['p. 8', 'Courrier des lecteurs']
	];
</script>

{#if kind === 'issue'}
	<!-- The cover, then its pages dealt out from under it. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		<rect class="iwac-vis-pipeline__paper" x="6" y="12" width="36" height="60" rx="2" />
		<rect class="iwac-vis-pipeline__ink" x="10" y="16" width="28" height="6" rx="1" />
		<rect class="iwac-vis-pipeline__photo" x="10" y="26" width="28" height="24" rx="1" />
		<rect class="iwac-vis-pipeline__print" x="10" y="55" width="22" height="2" rx="1" />
		<rect class="iwac-vis-pipeline__print" x="10" y="60" width="16" height="2" rx="1" />
		<text class="iwac-vis-pipeline__num" x="24" y="86">1</text>
		{#each PAGES as x, j (x)}
			<g class="iwac-vis-pipeline__fan" style:--iwac-vis-pipeline-j={j} style:--iwac-vis-pipeline-dx="{6 - x}px">
				<rect class="iwac-vis-pipeline__paper" {x} y="22" width="24" height="40" rx="2" />
				{#each { length: 6 } as _, k (k)}
					<rect class="iwac-vis-pipeline__print" x={x + 4} y={27 + k * 5} width={k % 3 === 2 ? 10 : 16} height="2" rx="1" />
				{/each}
				<text class="iwac-vis-pipeline__num" x={x + 12} y="86">{j + 2}</text>
			</g>
		{/each}
	</svg>
{:else if kind === 'page'}
	<!-- What the model lists for page 3: one article, and an advertisement set aside. -->
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">p. 3</p>
		<div class="iwac-vis-pipeline__toc-found iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0">
			<p class="iwac-vis-pipeline__toc-title"><span class="iwac-vis-pipeline__rubric">[Tribune]</span> {TITLE}</p>
			<p class="iwac-vis-pipeline__toc-author">La Rédaction</p>
			<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j="1"></span>
			<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j="1.5" style:--iwac-vis-pipeline-w="0.6"></span>
		</div>
		<p class="iwac-vis-pipeline__toc-aside" style:--iwac-vis-pipeline-j="2"><span class="iwac-vis-pipeline__dropped-title">{labels.advert}</span></p>
	</div>
{:else if kind === 'continuation'}
	<!-- Page 3 ends on its marker; the line runs to where page 7 picks the
	     article up. 136 wide, a phone's art column, so the words inside stay
	     at their own size rather than being scaled under the type floor. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		<rect class="iwac-vis-pipeline__paper" x="4" y="4" width="57" height="72" rx="2" />
		<rect class="iwac-vis-pipeline__ink" x="9" y="9" width="36" height="4" rx="1" />
		{#each { length: 9 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print" x="9" y={17 + k * 5} width={k % 4 === 3 ? 28 : 47} height="2" rx="1" />
		{/each}
		<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0">
			<rect class="iwac-vis-pipeline__marker-box" x="6.5" y="61" width="52" height="12" rx="1" />
			<text class="iwac-vis-pipeline__marker-text" x="32.5" y="70.5">suite p. 7</text>
		</g>
		<rect class="iwac-vis-pipeline__paper" x="75" y="4" width="57" height="72" rx="2" />
		<rect class="iwac-vis-pipeline__stub" x="80" y="9" width="26" height="3" rx="1" />
		{#each { length: 4 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print" x="80" y={16 + k * 5} width={k === 3 ? 28 : 47} height="2" rx="1" />
		{/each}
		<rect class="iwac-vis-pipeline__ink" x="80" y="42" width="34" height="4" rx="1" />
		{#each { length: 5 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print iwac-vis-pipeline__print--faint" x="80" y={50 + k * 5} width="47" height="2" rx="1" />
		{/each}
		<rect class="iwac-vis-pipeline__zone iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="2" x="78" y="7" width="51" height="29" rx="1" />
		<path
			class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw"
			style:--iwac-vis-pipeline-j="1"
			pathLength="1"
			d="M58.5 67 C 70 67, 64 15, 76 15"
		/>
		<!-- The head is its own mark, appearing as the line reaches it: the
		     trace ends at 220 + 200 + 600 ms, this rise starts at 220 + 5 × 160. -->
		<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="5" d="M72 12 L76 15 L72 18" />
		<text class="iwac-vis-pipeline__num" x="32.5" y="90">p. 3</text>
		<text class="iwac-vis-pipeline__num" x="103.5" y="90">p. 7</text>
	</svg>
{:else if kind === 'merge'}
	<!-- Two parts of one article, then the single entry they become. -->
	<div class="iwac-vis-pipeline__reconcile">
		<span class="iwac-vis-pipeline__fragment"><span class="iwac-vis-pipeline__pages">p. 3</span> {TITLE}</span>
		<span class="iwac-vis-pipeline__fragment"><span class="iwac-vis-pipeline__pages">p. 7</span> {TITLE} (suite)</span>
		<svg class="iwac-vis-pipeline__converge" viewBox="0 0 140 16" width="140" height="16" preserveAspectRatio="none">
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="0" pathLength="1" d="M30 0 C 30 10, 70 6, 70 16" />
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="0.4" pathLength="1" d="M110 0 C 110 10, 70 6, 70 16" />
		</svg>
		<span class="iwac-vis-pipeline__entry iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="1.5">
			<span class="iwac-vis-pipeline__entry-head"
				><span class="iwac-vis-pipeline__pages">p. 3, 7</span><span class="iwac-vis-pipeline__entry-title">{TITLE}</span></span
			>
			{#each [1, 1, 0.7] as w, k (k)}
				<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={2 + k * 0.5} style:--iwac-vis-pipeline-w={w}></span>
			{/each}
		</span>
	</div>
{:else if kind === 'contents'}
	<!-- The issue's table of contents, one line per article in page order. -->
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.contents}</p>
		<ol class="iwac-vis-pipeline__toc">
			{#each CONTENTS as [pages, title], j (pages)}
				<li
					class="iwac-vis-pipeline__toc-entry iwac-vis-pipeline__rise"
					class:iwac-vis-pipeline__toc-entry--merged={j === 1}
					style:--iwac-vis-pipeline-j={j}
				>
					<span class="iwac-vis-pipeline__pages">{pages}</span><span class="iwac-vis-pipeline__toc-entry-title">{title}</span>
				</li>
			{/each}
		</ol>
	</div>
{/if}
