<script>
	// The Albani Zaria sermons exhibition, in five drawings: a recording
	// transcribed in segments with its speakers, words counted however they
	// are spelt, a term with its neighbours, names sorted into a curated list,
	// and the figures and passages the page shows. No Hausa sentence is drawn:
	// the passages are lines, and the only words are ones the block's own
	// method section cites (ƙasa, ɗan, da, wato, matasa, shehu…).
	let { kind, labels } = $props();

	/** A waveform of 30 bars, cut into three 20-minute segments. */
	const BARS = Array.from({ length: 30 }, (_, k) =>
		k % 10 === 9 ? 2 : 4 + Math.round(20 * Math.abs(Math.sin(k * 1.7) * Math.cos(k * 0.45)))
	);
	const NORMALISE = [
		{ from: 'ƙasa · kasa', to: 'kasa' },
		{ from: 'ɗan · dan', to: 'dan' },
		{ from: 'da', to: '' },
		{ from: 'wato', to: '' }
	];
	/** Concordance lines: stubs either side of the term, the telling ones marked. */
	const KWIC = [
		[14, 8, 10],
		[9, 12, 7],
		[12, 6, 13]
	];
	const NAMES = [
		{ name: 'Zariya', cat: 'place', kept: true },
		{ name: 'Usman ɗan Fodiyo', cat: 'person', kept: true },
		{ name: 'shehu', cat: 'person', kept: false }
	];
</script>

{#if kind === 'recording'}
	<svg viewBox="0 0 140 96" width="140" height="96">
		{#each BARS as h, k (k)}
			<rect
				class="iwac-vis-pipeline__stub"
				x={18 + k * 3.5 + Math.floor(k / 10) * 4}
				y={22 - h / 2}
				width="2"
				height={h}
				rx="1"
			/>
		{/each}
		{#each [0, 1, 2] as s (s)}
			<text class="iwac-vis-pipeline__num" x={34 + s * 39} y="46">{s + 1}</text>
		{/each}
		<!-- Each segment's text, with the speaker the transcription estimates. -->
		{#each [0, 1, 2] as k (k)}
			<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={k}>
				<circle class={k === 1 ? 'iwac-vis-pipeline__badge-dot' : 'iwac-vis-pipeline__speaker'} cx="22" cy={58 + k * 12} r="4.5" />
				<text
					class="iwac-vis-pipeline__num {k === 1 ? 'iwac-vis-pipeline__num--on-dot' : ''}"
					x="22"
					y={61 + k * 12}>{k === 1 ? 'B' : 'A'}</text
				>
				<rect class="iwac-vis-pipeline__stub" x="32" y={57 + k * 12} width={[90, 64, 80][k]} height="2" rx="1" />
			</g>
		{/each}
	</svg>
{:else if kind === 'normalise'}
	<ul class="iwac-vis-pipeline__tokens">
		{#each NORMALISE as row, j (row.from)}
			<li class="iwac-vis-pipeline__token" class:iwac-vis-pipeline__token--dropped={!row.to}>
				<span class="iwac-vis-pipeline__word" style:--iwac-vis-pipeline-j={j}>{row.from}</span>
				{#if row.to}
					<span class="iwac-vis-pipeline__becomes">→</span>
					<span class="iwac-vis-pipeline__lemma iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>{row.to}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else if kind === 'terms'}
	<!-- Every line centred on the term; its neighbours within the window. -->
	<div class="iwac-vis-pipeline__sheet iwac-vis-pipeline__kwic">
		{#each KWIC as [left, right, far], j (j)}
			<p class="iwac-vis-pipeline__kwic-line">
				<span class="iwac-vis-pipeline__kwic-side">
					<span class="iwac-vis-pipeline__kwic-word" style:--iwac-vis-pipeline-w={far / 14}></span>
					<span
						class="iwac-vis-pipeline__kwic-word iwac-vis-pipeline__kwic-word--near iwac-vis-pipeline__grow"
						style:--iwac-vis-pipeline-w={left / 14}
						style:--iwac-vis-pipeline-j={j}
					></span>
				</span>
				<span class="iwac-vis-pipeline__term">matasa</span>
				<span class="iwac-vis-pipeline__kwic-side">
					<span class="iwac-vis-pipeline__kwic-word" style:--iwac-vis-pipeline-w={right / 14}></span>
					<span class="iwac-vis-pipeline__kwic-word" style:--iwac-vis-pipeline-w={far / 14}></span>
				</span>
			</p>
		{/each}
	</div>
{:else if kind === 'names'}
	<!-- Proposals sorted into the curated list: kept names become solid
	     entries, an ambiguous spelling stays a dashed proposal, left out. -->
	<ul class="iwac-vis-pipeline__candidates">
		{#each NAMES as entry, j (entry.name)}
			<li class="iwac-vis-pipeline__candidate" class:iwac-vis-pipeline__candidate--chosen={entry.kept}>
				<span class="iwac-vis-pipeline__tick iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}
					>{entry.kept ? '✓' : '×'}</span
				>
				{#if entry.kept}
					<span class="iwac-vis-pipeline__link" data-cat={entry.cat}
						><span class="iwac-vis-pipeline__link-name">{entry.name}</span></span
					>
				{:else}
					<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__mention--dropped" data-cat={entry.cat}
						>{entry.name}</span
					>
					<span class="iwac-vis-pipeline__accepted iwac-vis-pipeline__left-out">{labels.leftOut}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else if kind === 'figures'}
	<svg viewBox="0 0 140 96" width="140" height="96">
		{#each [34, 22, 28, 12] as h, k (k)}
			<rect
				class="iwac-vis-pipeline__chart-bar iwac-vis-pipeline__rise"
				style:--iwac-vis-pipeline-j={k * 0.5}
				x={14 + k * 12}
				y={44 - h}
				width="8"
				height={h}
				rx="1"
			/>
		{/each}
		<line class="iwac-vis-pipeline__axis" x1="10" x2="62" y1="44" y2="44" />
		<!-- A count leads to a passage, and the passage to its recording. -->
		<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="2" pathLength="1" d="M42 12 C 60 4, 70 10, 76 20" />
		<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="3">
			<rect class="iwac-vis-pipeline__paper" x="72" y="20" width="56" height="46" rx="2" />
			{#each { length: 4 } as _, k (k)}
				<rect class="iwac-vis-pipeline__stub" x="78" y={28 + k * 6} width={k === 3 ? 26 : 44} height="2" rx="1" />
			{/each}
			<circle class="iwac-vis-pipeline__badge-dot" cx="82" cy="58" r="4.5" />
			<path class="iwac-vis-pipeline__play" d="M80.5 55.5 L80.5 60.5 L84.5 58 Z" />
			<rect class="iwac-vis-pipeline__print" x="90" y="57" width="32" height="2" rx="1" />
		</g>
	</svg>
{/if}
