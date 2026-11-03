<script>
	// Press attitudes, in five drawings: the articles kept by language, one
	// article sent to every model of the panel, the three ratings on their
	// scales, a rating with its justification, and a model × model agreement
	// matrix in which one model reads differently from the rest. The
	// article, the ratings and the agreement figures are invented.
	let { kind, labels } = $props();

	const MODELS = [0, 1, 2, 3, 4, 5];
	/** [label key, steps on the scale, the step chosen]. */
	const SCALES = [
		['centrality', 5, 1],
		['polarity', 5, 2],
		['subjectivity', 5, 1]
	];
	/** How often two models agree, 0–1; model 3 is the one that reads apart. */
	function agreement(a, b) {
		if (a === b) return 1;
		if (a === 3 || b === 3) return 0.25;
		return 0.55 + ((a + b) % 3) * 0.12;
	}
</script>

{#if kind === 'article'}
	<div class="iwac-vis-pipeline__ask">
		<div class="iwac-vis-pipeline__sheet">
			<span class="iwac-vis-pipeline__line iwac-vis-pipeline__line--title"></span>
			{#each [1, 1, 0.85, 1, 0.5] as w, k (k)}
				<span class="iwac-vis-pipeline__line" style:--iwac-vis-pipeline-w={w}></span>
			{/each}
		</div>
		<p class="iwac-vis-pipeline__ask-terms">
			<span class="iwac-vis-pipeline__term iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0">fr</span>
			<span class="iwac-vis-pipeline__term iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0.5">en</span>
			<span class="iwac-vis-pipeline__dropped-title" style:--iwac-vis-pipeline-j="1">ee</span>
			<span class="iwac-vis-pipeline__dropped-title" style:--iwac-vis-pipeline-j="1.3">kbp</span>
		</p>
	</div>
{:else if kind === 'panel'}
	<!-- One article, the same instructions, every model on its own. -->
	<svg viewBox="0 0 140 96" width="140" height="96">
		<rect class="iwac-vis-pipeline__paper" x="10" y="24" width="34" height="46" rx="2" />
		<rect class="iwac-vis-pipeline__ink" x="14" y="29" width="22" height="3" rx="1" />
		{#each { length: 6 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print" x="14" y={36 + k * 5} width={k % 3 === 2 ? 16 : 26} height="2" rx="1" />
		{/each}
		<!-- The panel in two columns of three, so each model's number fits its
		     dot; the second column sits half a row lower, its lines passing
		     between the first column's dots. -->
		{#each MODELS as m (m)}
			{@const cx = m < 3 ? 94 : 122}
			{@const cy = 18 + (m % 3) * 27 + (m < 3 ? 0 : 13)}
			<path
				class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw"
				style:--iwac-vis-pipeline-j={m * 0.25}
				pathLength="1"
				d="M46 47 C 64 47, {cx - 22} {cy}, {cx - 9} {cy}"
			/>
			<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={1 + m * 0.25}>
				<circle class="iwac-vis-pipeline__badge-dot" {cx} {cy} r="8" />
				<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--on-dot" x={cx} y={cy + 3.5}>{m + 1}</text>
			</g>
		{/each}
	</svg>
{:else if kind === 'ratings'}
	<div class="iwac-vis-pipeline__card">
		{#each SCALES as [key, steps, on], j (key)}
			<div class="iwac-vis-pipeline__scale">
				<p class="iwac-vis-pipeline__scale-name">{labels[key]}</p>
				<p class="iwac-vis-pipeline__steps">
					{#each { length: steps } as _, k (k)}
						<span
							class="iwac-vis-pipeline__step"
							class:iwac-vis-pipeline__step--on={k === on}
							class:iwac-vis-pipeline__rise={k === on}
							style:--iwac-vis-pipeline-j={j * 0.6}
						></span>
					{/each}
				</p>
			</div>
		{/each}
	</div>
{:else if kind === 'reasons'}
	<!-- One model's rating and its reason; the others sit behind, kept apart. -->
	<div class="iwac-vis-pipeline__stack">
		<div class="iwac-vis-pipeline__card iwac-vis-pipeline__card--behind"></div>
		<div class="iwac-vis-pipeline__card">
			<p class="iwac-vis-pipeline__card-head">{labels.polarity} · Neutre</p>
			<p class="iwac-vis-pipeline__quote iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0">« L’article décrit la prière sans la juger. »</p>
			<p class="iwac-vis-pipeline__card-foot">{labels.model} 1</p>
		</div>
	</div>
{:else if kind === 'compare'}
	<!-- Model × model agreement: the darker the cell, the more often the pair agrees. -->
	<svg viewBox="0 0 140 96" width="140" height="96">
		{#each MODELS as a (a)}
			<text class="iwac-vis-pipeline__num" x="34" y={14 + a * 11}>{a + 1}</text>
			{#each MODELS as b (b)}
				<rect
					class="iwac-vis-pipeline__cell iwac-vis-pipeline__rise"
					class:iwac-vis-pipeline__cell--self={a === b}
					style:--iwac-vis-pipeline-j={(a + b) * 0.15}
					x={40 + b * 11}
					y={5 + a * 11}
					width="10"
					height="10"
					fill-opacity={a === b ? 1 : agreement(a, b)}
				/>
			{/each}
		{/each}
		<rect class="iwac-vis-pipeline__cell" x="40" y="74" width="10" height="10" fill-opacity="0.9" />
		<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--start" x="53" y="82">{labels.agree}</text>
		<rect class="iwac-vis-pipeline__cell" x="40" y="86" width="10" height="10" fill-opacity="0.25" />
		<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--start" x="53" y="94">{labels.disagree}</text>
	</svg>
{/if}
