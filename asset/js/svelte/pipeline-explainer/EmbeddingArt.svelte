<script>
	// Embeddings and reprint detection, in five drawings: a text cut into
	// overlapping passages, each read with the title; the passages turned
	// into numbers and averaged into one vector; two headlines worded apart
	// landing together while a third lands far off; scores ranked against a
	// threshold; and a pair from two newspapers whose shared wording confirms
	// the score, still to be checked. Headlines, positions and scores are
	// invented; the 0.91 cut-off is the pipeline's own.
	let { kind, labels } = $props();

	const lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
	/** A score as the page's language writes it: 0.84, or 0,84. */
	const num = (n) => n.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('-', '\u2212');

	/** The three overlapping passages, as [top, bottom] on the page. */
	const ZONES = [
		[15, 44],
		[38, 64],
		[58, 84]
	];
	const VECTOR = [0.12, -0.48, 0.07, null, 0.31];
	/** Faint dots: the rest of the collection, in the same flat picture. */
	const DOTS = [
		[14, 10], [36, 6], [58, 14], [76, 8], [124, 10], [8, 30], [46, 26], [66, 34],
		[86, 44], [126, 40], [40, 54], [62, 50], [104, 56], [128, 58], [80, 22]
	];
	/** [number, x, y]: 1 and 2 say the same thing in other words; 3 is about something else. */
	const POINTS = [
		[1, 94, 13],
		[2, 116, 30],
		[3, 22, 48]
	];
	const HEADLINES = ['Tabaski : le mouton flambe', 'Béliers hors de prix', 'Congrès des imams à Niamey'];
	/** Scores in rank order: [pair, cosine]; the cut-off falls between the first two. */
	const SCORES = [
		['A·B', 0.96],
		['1·2', 0.84],
		['1·3', 0.31]
	];
	const CUT = 0.91;
</script>

{#if kind === 'passages'}
	<!-- The page with a bracket per passage (the middle one set out, so the
	     overlaps show as two brackets side by side), and each passage carried
	     out with the title on top. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		<rect class="iwac-vis-pipeline__paper" x="4" y="4" width="46" height="84" rx="2" />
		<rect class="iwac-vis-pipeline__ink" x="8" y="8" width="32" height="4" rx="1" />
		{#each { length: 13 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print" x="8" y={18 + k * 5.2} width={k % 4 === 3 ? 24 : 38} height="2" rx="1" />
		{/each}
		<!-- Where two passages overlap, the same lines go into both. -->
		<rect class="iwac-vis-pipeline__overlap" x="6" y="38" width="42" height="6" />
		<rect class="iwac-vis-pipeline__overlap" x="6" y="58" width="42" height="6" />
		{#each ZONES as [top, bottom], j (top)}
			{@const bx = j === 1 ? 59 : 54}
			<path
				class="iwac-vis-pipeline__bracket iwac-vis-pipeline__rise"
				style:--iwac-vis-pipeline-j={j * 0.5}
				d="M{bx - 3} {top} L{bx} {top} L{bx} {bottom} L{bx - 3} {bottom}"
			/>
			<path
				class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw"
				style:--iwac-vis-pipeline-j={1 + j * 0.6}
				pathLength="1"
				d="M{bx + 1} {(top + bottom) / 2} C 70 {(top + bottom) / 2}, 68 {14 + j * 29}, 78 {14 + j * 29}"
			/>
			<!-- Each passage appears as its line reaches it: the trace ends at
			     220 + (1 + 0.6j) × 200 + 600 ms, this rise starts at 220 + its j × 160. -->
			<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={5 + j * 0.75}>
				<rect class="iwac-vis-pipeline__paper" x="79" y={3 + j * 29} width="52" height="22" rx="2" />
				<rect class="iwac-vis-pipeline__ink" x="83" y={7 + j * 29} width="22" height="3" rx="1" />
				<rect class="iwac-vis-pipeline__print" x="83" y={13 + j * 29} width="44" height="2" rx="1" />
				<rect class="iwac-vis-pipeline__print" x="83" y={18 + j * 29} width={j === 2 ? 24 : 40} height="2" rx="1" />
			</g>
		{/each}
	</svg>
{:else if kind === 'vector'}
	<!-- Three passages, one vector: the lines converge on the averaged column. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		{#each [0, 1, 2] as k (k)}
			<g transform="translate(0 {k * 26})">
				<rect class="iwac-vis-pipeline__paper" x="4" y="8" width="30" height="20" rx="2" />
				<rect class="iwac-vis-pipeline__ink" x="7" y="11" width="14" height="3" rx="1" />
				<rect class="iwac-vis-pipeline__print" x="7" y="17" width="24" height="2" rx="1" />
				<rect class="iwac-vis-pipeline__print" x="7" y="22" width="18" height="2" rx="1" />
			</g>
			<path
				class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw"
				style:--iwac-vis-pipeline-j={k * 0.3}
				pathLength="1"
				d="M36 {18 + k * 26} C 46 {18 + k * 26}, 44 44, 56 44"
			/>
		{/each}
		<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="4.5" d="M53 41 L57 44 L53 47" />
		<path class="iwac-vis-pipeline__bracket" d="M70 6 L64 6 L64 84 L70 84 M120 6 L126 6 L126 84 L120 84" />
		{#each VECTOR as value, k (k)}
			<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--value iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={5 + k * 0.5} x="95" y={20 + k * 15}
				>{value === null ? '⋮' : num(value)}</text
			>
		{/each}
	</svg>
{:else if kind === 'space'}
	<!-- Close points, close meanings: 1 and 2 share no word; 3 is about something else. -->
	<div class="iwac-vis-pipeline__space">
		<svg viewBox="0 0 136 64" width="136" height="64">
			{#each DOTS as [x, y] (`${x}-${y}`)}
				<circle class="iwac-vis-pipeline__print" cx={x} cy={y} r="1.6" />
			{/each}
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="2.5" pathLength="1" d="M99 17 L111 26" />
			{#each POINTS as [n, x, y], j (n)}
				<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j * 1.2}>
					<circle class="iwac-vis-pipeline__badge-dot" cx={x} cy={y} r="6.5" />
					<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--on-dot" {x} y={y + 3.5}>{n}</text>
				</g>
			{/each}
		</svg>
		<ol class="iwac-vis-pipeline__snippets">
			{#each HEADLINES as headline, j (headline)}
				<li class="iwac-vis-pipeline__snippet iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j * 1.2}>
					<span class="iwac-vis-pipeline__snippet-n">{j + 1}</span><span class="iwac-vis-pipeline__snippet-text">{`«\u00a0${headline}\u00a0»`}</span>
				</li>
			{/each}
		</ol>
	</div>
{:else if kind === 'score'}
	<!-- Pairs ranked by score; the dashed cut-off sends only the first on to the reprint check. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		{#each SCORES as [pair, score], k (pair)}
			{@const y = k === 0 ? 14 : 34 + k * 22}
			<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--start" x="4" y={y + 4}>{pair}</text>
			<line class="iwac-vis-pipeline__axis" x1="30" y1={y} x2="100" y2={y} />
			<rect
				class="iwac-vis-pipeline__chart-bar iwac-vis-pipeline__grow"
				class:iwac-vis-pipeline__chart-bar--over={score >= CUT}
				style:--iwac-vis-pipeline-j={k * 0.8}
				x="30"
				y={y - 3}
				width={score * 70}
				height="6"
				rx="1"
			/>
			<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--end" x="132" y={y + 4}>{num(score)}</text>
		{/each}
		<!-- Dashed, so it fades in rather than being traced: a trace would
		     replace the dashes with its own pattern. -->
		<line class="iwac-vis-pipeline__threshold iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="5" x1="4" y1="36" x2="132" y2="36" />
		<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--end iwac-vis-pipeline__num--cut iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="5.5" x="132" y="31">≥ {num(CUT)}</text>
	</svg>
{:else if kind === 'reprints'}
	<!-- Two newspapers, two mastheads, the same sentences: the shared wording
	     confirms what the score suggested, and a reader still has to check. -->
	<div class="iwac-vis-pipeline__space">
		<svg viewBox="0 0 136 90" width="136" height="90">
			{#each [0, 1] as s (s)}
				{@const x = 4 + s * 70}
				<rect class="iwac-vis-pipeline__paper" {x} y="4" width="58" height="62" rx="2" />
				{#if s === 0}
					<rect class="iwac-vis-pipeline__ink" x={x + 5} y="8" width="42" height="6" rx="1" />
				{:else}
					<rect class="iwac-vis-pipeline__ink" x={x + 5} y="8" width="20" height="6" rx="3" />
					<rect class="iwac-vis-pipeline__stub" x={x + 28} y="10" width="22" height="2" rx="1" />
				{/if}
				{#each { length: 8 } as _, k (k)}
					<rect class="iwac-vis-pipeline__print" x={x + 5} y={20 + k * 5.6} width={k % 4 === 3 ? 30 : 48} height="2" rx="1" />
				{/each}
				<!-- The same passage, a line lower in the second paper. -->
				{#each [1, 2, 5] as line, j (line)}
					<rect
						class="iwac-vis-pipeline__marker-box iwac-vis-pipeline__rise"
						style:--iwac-vis-pipeline-j={j * 0.5}
						x={x + 4}
						y={18.5 + (line + s) * 5.6}
						width="50"
						height="5"
						rx="1"
					/>
				{/each}
			{/each}
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="2" pathLength="1" d="M33 67 C 33 75, 103 75, 103 67" />
			<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--value iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="6.3" x="68" y="87">{num(0.96)}</text>
		</svg>
		<p class="iwac-vis-pipeline__flag iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="7">{labels.toCheck}</p>
	</div>
{/if}
