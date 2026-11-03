<script>
	// OCR with AI, in two routes of four drawings. Direct extraction: a scanned
	// newspaper page, the reading order its columns are taken in, the text the
	// model writes, and that text set beside the scan. Post-correction: noisy
	// OCR with its misreadings, cut into sections, corrected, and compared
	// with the original it keeps. The page and the misreadings are invented.
	let { kind, labels } = $props();

	/** The page: x of each of its three columns, 19 units wide. */
	const COLS = [39, 60, 81];
	/** Reading zones the instructions set, in order — three columns, then the
	 *  caption — each with where its number sits. */
	const ZONES = [
		{ x: 37, y: 16, w: 22, h: 72, n: 1, bx: 56, by: 20 },
		{ x: 58, y: 45, w: 22, h: 43, n: 2, bx: 77, by: 49 },
		{ x: 79, y: 45, w: 22, h: 43, n: 3, bx: 98, by: 49 },
		{ x: 58, y: 36, w: 43, h: 8, n: 4, bx: 109, by: 40 }
	];
	/** Older OCR, misread: [before, misread, after], and what the correction restores. */
	const LINES = [
		['', 'Ia', ' mosquée de', 'la'],
		['Lom', '6', ' accueille', 'é'],
		['les fid', 'Ã¨', 'les', 'è']
	];
</script>

{#snippet page(ink)}
	<rect class="iwac-vis-pipeline__paper" x="34" y="4" width="72" height="88" rx="2" />
	<rect class="iwac-vis-pipeline__ink" x="39" y="8" width="62" height="4" rx="1" />
	<rect class="iwac-vis-pipeline__photo" x="60" y="18" width="40" height="16" rx="1" />
	<rect class={ink} x="60" y="38" width="30" height="2" rx="1" />
	{#each COLS as x, c (c)}
		{#each { length: c === 0 ? 14 : 8 } as _, k (k)}
			<rect
				class={ink}
				{x}
				y={(c === 0 ? 18 : 48) + k * 5}
				width={k % 5 === 4 ? 11 : 19}
				height="2"
				rx="1"
			/>
		{/each}
	{/each}
{/snippet}

{#if kind === 'scan'}
	<svg viewBox="0 0 140 96" width="140" height="96">
		{@render page('iwac-vis-pipeline__print')}
	</svg>
{:else if kind === 'order'}
	<svg viewBox="0 0 140 96" width="140" height="96">
		{@render page('iwac-vis-pipeline__print iwac-vis-pipeline__print--faint')}
		<!-- From each zone's number to the next: the order, not the eye's path. -->
		<path
			class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw"
			style:--iwac-vis-pipeline-j="1"
			pathLength="1"
			d="M56 20 L77 49 L98 49 L109 40"
		/>
		{#each ZONES as zone, j (zone.n)}
			<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j={j}>
				<rect class="iwac-vis-pipeline__zone" x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="1" />
				<circle class="iwac-vis-pipeline__badge-dot" cx={zone.bx} cy={zone.by} r="4.5" />
				<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--on-dot" x={zone.bx} y={zone.by + 3}
					>{zone.n}</text
				>
			</g>
		{/each}
	</svg>
{:else if kind === 'transcribe'}
	<div class="iwac-vis-pipeline__sheet">
		{#each [0, 1, 2] as k (k)}
			<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={k} style:--iwac-vis-pipeline-w={k === 2 ? 0.6 : 1}
			></span>
		{/each}
		<span class="iwac-vis-pipeline__marker iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="3">--- Page 2 ---</span>
		{#each [0, 1] as k (k)}
			<span class="iwac-vis-pipeline__line iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={4 + k} style:--iwac-vis-pipeline-w={k === 1 ? 0.7 : 1}
			></span>
		{/each}
	</div>
{:else if kind === 'assembled'}
	<!-- The text beside its scan; one passage to verify against the image. -->
	<svg viewBox="0 0 140 96" width="140" height="96">
		<rect class="iwac-vis-pipeline__paper" x="12" y="4" width="50" height="72" rx="2" />
		<rect class="iwac-vis-pipeline__photo" x="17" y="9" width="40" height="12" rx="1" />
		{#each { length: 9 } as _, k (k)}
			<rect class="iwac-vis-pipeline__print" x="17" y={25 + k * 5} width={k % 4 === 3 ? 24 : 40} height="2" rx="1" />
		{/each}
		<rect class="iwac-vis-pipeline__paper" x="78" y="4" width="50" height="72" rx="2" />
		{#each { length: 11 } as _, k (k)}
			<rect class="iwac-vis-pipeline__stub" x="83" y={10 + k * 5} width={k % 4 === 3 ? 24 : 40} height="2" rx="1" />
		{/each}
		<g class="iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="1">
			<rect class="iwac-vis-pipeline__zone" x="15" y="38" width="44" height="7" rx="1" />
			<rect class="iwac-vis-pipeline__flaw" x="81" y="33" width="44" height="7" rx="1" />
			<path class="iwac-vis-pipeline__route-line" d="M59 41.5 L81 36.5" />
		</g>
		<text class="iwac-vis-pipeline__num" x="37" y="90">{labels.scan}</text>
		<text class="iwac-vis-pipeline__num" x="103" y="90">{labels.text}</text>
	</svg>
{:else if kind === 'legacy' || kind === 'correct'}
	<div class="iwac-vis-pipeline__sheet iwac-vis-pipeline__sheet--mono">
		{#each LINES as [before, misread, after, fixed], j (j)}
			<p class="iwac-vis-pipeline__ocr-line">
				{before}{#if kind === 'legacy'}<span class="iwac-vis-pipeline__flaw-text">{misread}</span>{:else}<span
						class="iwac-vis-pipeline__fix iwac-vis-pipeline__rise"
						style:--iwac-vis-pipeline-j={j}>{fixed}</span
					>{/if}{after}
			</p>
		{/each}
	</div>
{:else if kind === 'sections'}
	<!-- One long text, cut into sections that each fit a request. -->
	<svg viewBox="0 0 140 96" width="140" height="96">
		{#each [0, 1, 2] as j (j)}
			{@const x = 18 + j * 38}
			<g class="iwac-vis-pipeline__fan" style:--iwac-vis-pipeline-j={j} style:--iwac-vis-pipeline-dx="{56 - x}px">
				<rect class="iwac-vis-pipeline__paper" {x} y="10" width="28" height="56" rx="2" />
				{#each { length: 8 } as _, k (k)}
					<rect
						class="iwac-vis-pipeline__print"
						x={x + 4}
						y={16 + k * 6}
						width={k % 4 === 3 ? 12 : 20}
						height="2"
						rx="1"
					/>
				{/each}
				<text class="iwac-vis-pipeline__num" x={x + 14} y="82">{j + 1}</text>
			</g>
		{/each}
	</svg>
{:else if kind === 'corrected'}
	<!-- The original OCR is kept beside the correction; a historical name stays as printed. -->
	<div class="iwac-vis-pipeline__compare">
		{#each [labels.ocr, labels.corrected] as heading, side (side)}
			<div class="iwac-vis-pipeline__sheet iwac-vis-pipeline__sheet--mono">
				<p class="iwac-vis-pipeline__card-head">{heading}</p>
				<p class="iwac-vis-pipeline__ocr-line">
					{#if side === 0}<span class="iwac-vis-pipeline__flaw-text">Ia</span>{:else}<span
							class="iwac-vis-pipeline__fix iwac-vis-pipeline__rise">la</span
						>{/if} mosquée
				</p>
				<p class="iwac-vis-pipeline__ocr-line">
					au <span class:iwac-vis-pipeline__kept={side === 1}>Dahomey</span>
				</p>
			</div>
		{/each}
	</div>
	<p class="iwac-vis-pipeline__legend"><span class="iwac-vis-pipeline__kept">&nbsp;&nbsp;</span> {labels.kept}</p>
{/if}
