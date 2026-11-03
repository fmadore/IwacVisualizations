<script>
	// Entity extraction and enrichment, in four drawings: names found in an
	// article, spelling variants converging on one authority record, a name a
	// researcher has to settle, and the article's record with its links.
	//
	// A MENTION is drawn with a dashed outline and a LINK as a solid chip with
	// a link mark — the difference the captions explain, kept visible. Each
	// category has its theme colour (--type-entity-*) and its name beside it.
	// The variants are the ones IWAC's AI metadata enrichment page cites; the
	// sentence around them is invented.
	let { kind, labels } = $props();

	const CATEGORIES = ['person', 'organisation', 'place', 'subject'];
	const RECORD = 'Abdou-Salami Abdou Rahim';
	const LINKS = [
		['subject', 'person', RECORD],
		['subject', 'organisation', 'Union musulmane du Togo'],
		['subject', 'subject', 'Tabaski'],
		['spatial', 'place', 'Lomé']
	];
</script>

{#snippet link(cat, name, j)}
	<span class="iwac-vis-pipeline__link iwac-vis-pipeline__rise" data-cat={cat} style:--iwac-vis-pipeline-j={j}>
		<svg class="iwac-vis-pipeline__link-mark" viewBox="0 0 12 12" width="10" height="10">
			<path d="M5 7 L7 5 M4.5 3.5 L5.5 2.5 a2.1 2.1 0 0 1 3 3 L7.5 6.5 M4.5 5.5 L3.5 6.5 a2.1 2.1 0 0 0 3 3 L7.5 8.5" />
		</svg>
		<span class="iwac-vis-pipeline__link-name">{name}</span>
	</span>
{/snippet}

{#if kind === 'mentions'}
	<div class="iwac-vis-pipeline__sheet iwac-vis-pipeline__sheet--text">
		<p>
			<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__rise" data-cat="person" style:--iwac-vis-pipeline-j="0"
				><span class="iwac-vis-pipeline__dropped-title">El Hadj</span> Abdou Rahim</span
			>, imam, à
			<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__rise" data-cat="place" style:--iwac-vis-pipeline-j="1">Lomé</span>
			pour l’<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__rise" data-cat="organisation" style:--iwac-vis-pipeline-j="2"
				>UMT</span
			>
			et la
			<span class="iwac-vis-pipeline__mention iwac-vis-pipeline__rise" data-cat="subject" style:--iwac-vis-pipeline-j="3">Tabaski</span>.
		</p>
	</div>
	<ul class="iwac-vis-pipeline__categories">
		{#each CATEGORIES as cat (cat)}
			<li class="iwac-vis-pipeline__category" data-cat={cat}>{labels[cat]}</li>
		{/each}
	</ul>
{:else if kind === 'reconcile'}
	<div class="iwac-vis-pipeline__reconcile">
		<span class="iwac-vis-pipeline__mention" data-cat="person">Abdul Salam Abdul Rahim</span>
		<span class="iwac-vis-pipeline__mention" data-cat="person">Abdou Rahim</span>
		<svg class="iwac-vis-pipeline__converge" viewBox="0 0 140 16" width="140" height="16" preserveAspectRatio="none">
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="0" pathLength="1" d="M30 0 C 30 10, 70 6, 70 16" />
			<path class="iwac-vis-pipeline__route-line iwac-vis-pipeline__draw" style:--iwac-vis-pipeline-j="0.4" pathLength="1" d="M110 0 C 110 10, 70 6, 70 16" />
		</svg>
		<span class="iwac-vis-pipeline__record iwac-vis-pipeline__rise" data-cat="person" style:--iwac-vis-pipeline-j="1.5">
			<span class="iwac-vis-pipeline__record-type">{labels.record} · {labels.person}</span>
			<span class="iwac-vis-pipeline__record-name">{RECORD}</span>
		</span>
	</div>
{:else if kind === 'review'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">
			<span class="iwac-vis-pipeline__mention" data-cat="person">A. Rahim</span>
			<span class="iwac-vis-pipeline__flag">{labels.review}</span>
		</p>
		<ul class="iwac-vis-pipeline__candidates">
			<li class="iwac-vis-pipeline__candidate iwac-vis-pipeline__candidate--chosen">
				<span class="iwac-vis-pipeline__tick iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="1">✓</span>
				<span class="iwac-vis-pipeline__candidate-name">{RECORD}</span>
				<span class="iwac-vis-pipeline__accepted iwac-vis-pipeline__rise" style:--iwac-vis-pipeline-j="1.5">{labels.accepted}</span>
			</li>
			<li class="iwac-vis-pipeline__candidate">
				<span class="iwac-vis-pipeline__tick"></span>
				<span class="iwac-vis-pipeline__candidate-name">{labels.newRecord}</span>
			</li>
		</ul>
	</div>
{:else if kind === 'linked'}
	<div class="iwac-vis-pipeline__card">
		<p class="iwac-vis-pipeline__card-head">{labels.article}</p>
		<dl class="iwac-vis-pipeline__fields">
			{#each [['subject', labels.subject], ['spatial', labels.spatial]] as [field, label] (field)}
				<dt>{label}</dt>
				<dd>
					{#each LINKS.filter((l) => l[0] === field) as [, cat, name], j (name)}
						{@render link(cat, name, field === 'spatial' ? 3 : j)}
					{/each}
				</dd>
			{/each}
		</dl>
	</div>
{/if}
