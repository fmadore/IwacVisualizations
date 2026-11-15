<script>
	// What it holds: one proportional strip of the item types, and the ledger
	// that carries their counts. The strip is decoration (aria-hidden); each
	// colour is the theme's --type-* category colour and has its name beside
	// it in the ledger.
	let { data, labels, fmt } = $props();

	/** Literal class names, so the stylesheet's dead-class check can see them. */
	const DOT = {
		article: 'iwac-vis-intro__dot--article',
		publication: 'iwac-vis-intro__dot--publication',
		audiovisual: 'iwac-vis-intro__dot--audiovisual',
		document: 'iwac-vis-intro__dot--document',
		reference: 'iwac-vis-intro__dot--reference',
		photograph: 'iwac-vis-intro__dot--photograph'
	};
</script>

<p class="iwac-vis-intro__caption">{labels.byType}</p>
<div class="iwac-vis-intro__strip" aria-hidden="true">
	{#each data.types as type, j (type.key)}
		<span
			class="iwac-vis-intro__segment {DOT[type.token]}"
			style:flex-grow={type.count}
			style:--iwac-vis-intro-j={j}
		></span>
	{/each}
</div>
<ul class="iwac-vis-intro__ledger">
	{#each data.types as type, j (type.key)}
		<li class="iwac-vis-intro__row iwac-vis-intro__rise" style:--iwac-vis-intro-j={j}>
			<span class="iwac-vis-intro__dot {DOT[type.token]}" aria-hidden="true"></span>
			<span class="iwac-vis-intro__name">{labels['type.' + type.key]}</span>
			<span class="iwac-vis-intro__num">{fmt.number(type.count)}</span>
			<span class="iwac-vis-intro__pct">{fmt.percent(type.share, 1)}</span>
		</li>
	{/each}
</ul>
