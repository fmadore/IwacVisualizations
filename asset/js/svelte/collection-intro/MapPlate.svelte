<script>
	// Where it comes from: the six countries tinted by their item counts on
	// one hue, in four steps, and the ledger that names and counts them. The
	// map is decoration (aria-hidden): every country it draws is labelled on
	// it, and its count and step are in the ledger, so nothing depends on
	// telling the tints apart.
	import { LABEL_SIZE } from './geo.js';

	let { data, labels, fmt } = $props();

	/** Literal class names, so the stylesheet's dead-class check can see them. */
	const STEP = [
		'iwac-vis-intro__step--0',
		'iwac-vis-intro__step--1',
		'iwac-vis-intro__step--2',
		'iwac-vis-intro__step--3',
		'iwac-vis-intro__step--4'
	];
	const rank = (row) => (row ? data.rows.indexOf(row) : data.rows.length);
</script>

<div class="iwac-vis-intro__geo" class:iwac-vis-intro__geo--mapped={data.map}>
	{#if data.map}
		<svg
			class="iwac-vis-intro__map"
			viewBox="0 0 {data.map.width} {data.map.height}"
			aria-hidden="true"
			focusable="false"
		>
			{#each data.map.shapes as shape (shape.name)}
				<path
					class="iwac-vis-intro__land {STEP[shape.row ? shape.row.step : 0]}"
					d={shape.d}
					style:--iwac-vis-intro-j={rank(shape.row)}
				/>
			{/each}
			{#each data.map.shapes as shape (shape.name)}
				<g class="iwac-vis-intro__place iwac-vis-intro__rise" style:--iwac-vis-intro-j={rank(shape.row)}>
					{#if shape.label.leader}
						<line
							class="iwac-vis-intro__leader"
							x1={shape.label.leader.x1}
							y1={shape.label.leader.y1}
							x2={shape.label.leader.x2}
							y2={shape.label.leader.y2}
						/>
					{/if}
					<text
						class="iwac-vis-intro__place-name"
						class:iwac-vis-intro__place-name--on-primary={!shape.label.leader && shape.row && shape.row.step === 4}
						x={shape.label.x}
						y={shape.label.y}
						text-anchor={shape.label.anchor}
						font-size={LABEL_SIZE}
					>
						{#each shape.label.lines as line, k (k)}
							<tspan x={shape.label.x} dy={k ? '1.1em' : 0}>{line}</tspan>
						{/each}
					</text>
				</g>
			{/each}
		</svg>
	{/if}
	<div class="iwac-vis-intro__key">
		<p class="iwac-vis-intro__caption">{labels.byCountry}</p>
		<ol class="iwac-vis-intro__ledger">
			{#each data.rows as row, j (row.name)}
				<li class="iwac-vis-intro__row iwac-vis-intro__rise" style:--iwac-vis-intro-j={j}>
					<span class="iwac-vis-intro__swatch {STEP[row.step]}" aria-hidden="true"></span>
					<span class="iwac-vis-intro__name">{row.name}</span>
					<span class="iwac-vis-intro__num">{fmt.number(row.count)}</span>
					<span class="iwac-vis-intro__pct">{fmt.percent(row.share, 1)}</span>
				</li>
			{/each}
		</ol>
	</div>
</div>
