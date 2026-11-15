<script>
	// The years it covers: items per year as bars that rise left to right,
	// the peak year named over its bar, and the totals by decade under the
	// axis. The bars are decoration (aria-hidden); the peak and every decade
	// total are text.
	//
	// The bars are drawn in a viewBox one unit per year and stretched to the
	// width (preserveAspectRatio="none"), so they always fill the column; the
	// words around them are HTML, so they keep their size on a phone.
	let { data, labels, fmt } = $props();

	const n = $derived(data.bars.length);
	/** Rise stagger: the whole run of bars starts within 900 ms. */
	const stagger = $derived(Math.min(14, 900 / Math.max(1, n)));
	const peakAt = $derived(((data.peak.index + 0.5) / n) * 100);
	const height = (count) => (count > 0 ? Math.max(0.8, (count / data.peak.count) * 100) : 0);
	const decade = (cell) => labels.decade.replace('{decade}', String(cell.decade));
</script>

<p class="iwac-vis-intro__caption">{labels.perYear}</p>
<div class="iwac-vis-intro__chart">
	<p
		class="iwac-vis-intro__peak iwac-vis-intro__rise"
		class:iwac-vis-intro__peak--end={peakAt > 60}
		style:--iwac-vis-intro-x="{peakAt}%"
		style:--iwac-vis-intro-j={4}
	>
		<span class="iwac-vis-intro__peak-label">{labels.peak}</span>
		<span class="iwac-vis-intro__peak-value">{data.peak.year} · {fmt.number(data.peak.count)}</span>
	</p>
	<svg
		class="iwac-vis-intro__bars"
		viewBox="0 0 {n} 100"
		preserveAspectRatio="none"
		aria-hidden="true"
		focusable="false"
	>
		{#each data.bars as bar, j (bar.year)}
			{#if bar.count > 0}
				<rect
					class="iwac-vis-intro__bar"
					class:iwac-vis-intro__bar--peak={j === data.peak.index}
					x={j + 0.14}
					width="0.72"
					y={100 - height(bar.count)}
					height={height(bar.count)}
					style:--iwac-vis-intro-at="{Math.round(j * stagger)}ms"
				/>
			{/if}
		{/each}
	</svg>
	<ol class="iwac-vis-intro__decades" aria-label={labels.perDecade}>
		{#each data.decades as cell, j (cell.decade)}
			<li class="iwac-vis-intro__decade iwac-vis-intro__rise" style:flex-grow={cell.years} style:--iwac-vis-intro-j={j}>
				<span class="iwac-vis-intro__tick" aria-hidden="true">{cell.start}</span>
				<span class="iwac-vis-intro__sr">{decade(cell)}</span>
				<span class="iwac-vis-intro__num">{fmt.number(cell.total)}</span>
			</li>
		{/each}
	</ol>
	<p class="iwac-vis-intro__axis-note" aria-hidden="true">{labels.perDecade}</p>
</div>
