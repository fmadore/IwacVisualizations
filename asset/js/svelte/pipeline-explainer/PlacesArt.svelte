<script>
	// How a place gets on the map, in five drawings: an article linked to
	// Parakou under Spatial coverage while Malanville is only named in its
	// text; Parakou's index entry with its coordinates; items counted per
	// place; bubbles at their coordinates, radius by square root of the
	// count; and what stays off the map. The towns and their coordinates are
	// real (rounded); the article, the links and the counts are invented.
	let { kind, labels } = $props();

	/** [place, items linked to it, x, y]: real positions, on the outline below. */
	const PLACES = [
		['Parakou', 9, 36.3, 47.5],
		['Djougou', 4, 22.9, 42.4],
		['Kandi', 1, 40.7, 22.5]
	];
	/** Radius grows with √count (P.countRadius), from a small floor. */
	const radius = (n) => 1.5 + 2.6 * Math.sqrt(n);
	/** Where each label sits, with a hairline back to its bubble. */
	const LABEL_Y = [56, 36, 20];
	/** A simplified outline of Benin, longitude/latitude mapped to the box. */
	const OUTLINE =
		'M22.2 91.2 L37.6 89.3 L37.9 69.1 L42.9 53.7 L49.9 39.7 L50.6 29.9 L53.4 14.5 L49.2 12.4 L39.4 4.7 L33.1 11.7 L21.9 18.7 L12.4 24.3 L10.4 32.7 L18.4 39.7 L22.2 50.9 Z';
</script>

{#snippet link(name, j)}
	<span class="iwac-vis-pipeline__link iwac-vis-pipeline__rise" data-cat="place" style:--iwac-vis-pipeline-j={j}>
		<svg class="iwac-vis-pipeline__link-mark" viewBox="0 0 12 12" width="10" height="10">
			<path d="M5 7 L7 5 M4.5 3.5 L5.5 2.5 a2.1 2.1 0 0 1 3 3 L7.5 6.5 M4.5 5.5 L3.5 6.5 a2.1 2.1 0 0 0 3 3 L7.5 8.5" />
		</svg>
		<span class="iwac-vis-pipeline__link-name">{name}</span>
	</span>
{/snippet}

{#if kind === 'linked'}
	<!-- Both towns are in the text; only Parakou is linked, so only Parakou can reach the map. -->
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.article}</p>
		<p class="iwac-vis-pipeline__quote">Tabaski à <span class="iwac-vis-pipeline__linked-word" data-cat="place">Parakou</span> : des fidèles venus de Malanville.</p>
		<dl class="iwac-vis-pipeline__fields">
			<dt>{labels.spatial}</dt>
			<dd>{@render link('Parakou', 1)}</dd>
		</dl>
	</div>
{:else if kind === 'entry'}
	<div class="iwac-vis-pipeline__record iwac-vis-pipeline__record--entry" data-cat="place">
		<span class="iwac-vis-pipeline__record-type">{labels.record} · {labels.place}</span>
		<span class="iwac-vis-pipeline__record-name">Parakou</span>
		<dl class="iwac-vis-pipeline__fields">
			<dt>{labels.partOf}</dt>
			<dd>Borgou</dd>
			<dt>{labels.coordinates}</dt>
			<dd class="iwac-vis-pipeline__coords iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="1">9.34, 2.63</dd>
		</dl>
	</div>
{:else if kind === 'counts'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.items}</p>
		<ul class="iwac-vis-pipeline__counts">
			{#each PLACES as [place, n], j (place)}
				<li class="iwac-vis-pipeline__count">
					<span class="iwac-vis-pipeline__count-word">{place}</span>
					<span class="iwac-vis-pipeline__bar iwac-vis-pipeline__grow" style:--iwac-vis-pipeline-j={j} style:--iwac-vis-pipeline-w={n / 9}></span>
					<span class="iwac-vis-pipeline__count-n">{n}</span>
				</li>
			{/each}
		</ul>
	</div>
{:else if kind === 'bubbles'}
	<!-- Each bubble at its town; nine items give a bubble about three times
	     as wide as one item, not nine. -->
	<svg viewBox="0 0 136 96" width="136" height="96">
		<path class="iwac-vis-pipeline__paper" d={OUTLINE} />
		{#each PLACES as [place, n, x, y], j (place)}
			<line class="iwac-vis-pipeline__leader" x1={x + radius(n) * 0.7} y1={y + (LABEL_Y[j] > y ? 1 : -1) * radius(n) * 0.7} x2="64" y2={LABEL_Y[j] - 4} />
			<circle class="iwac-vis-pipeline__map-bubble iwac-vis-pipeline__pop" style:--iwac-vis-pipeline-j={j * 0.8} cx={x} cy={y} r={radius(n)} />
			<text class="iwac-vis-pipeline__num iwac-vis-pipeline__num--start iwac-vis-pipeline__num--ink" x="66" y={LABEL_Y[j]}>{place} {n}</text>
		{/each}
	</svg>
{:else if kind === 'absent'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.leftOut}</p>
		<p class="iwac-vis-pipeline__absent">
			{@render link('Zongo', 0)}
			<span class="iwac-vis-pipeline__absent-why iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="0.8">{labels.noCoordinates}</span>
		</p>
		<p class="iwac-vis-pipeline__absent">
			<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__rise" data-cat="place" style:--iwac-vis-pipeline-j="2">Malanville</span>
			<span class="iwac-vis-pipeline__absent-why iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="2.8">{labels.textOnly}</span>
		</p>
	</div>
{/if}
