<script>
	// Languages and subjects: every language with a proportional bar and its
	// count (a long tail is pooled only past a dozen, so the African-language
	// items are never folded into "other" at today's scale), then the
	// entries the index tags most often, by type, each linked to its record.
	// Language names and index types come from the module's one translation
	// table (iwac-i18n.js: `lang_*`, `entity_type_*`).
	let { data, labels, fmt, siteBase } = $props();

	/** Literal class names, so the stylesheet's dead-class check can see them. */
	const DOT = {
		personnes: 'iwac-vis-intro__dot--personnes',
		organisations: 'iwac-vis-intro__dot--organisations',
		sujets: 'iwac-vis-intro__dot--sujets',
		lieux: 'iwac-vis-intro__dot--lieux',
		evenements: 'iwac-vis-intro__dot--evenements'
	};

	function language(row) {
		if (row.other) return labels.otherLanguages;
		const key = 'lang_' + row.name;
		const label = fmt.t(key);
		return label && label !== key ? label : row.name;
	}
	const href = (item) => (siteBase && item.id !== null ? fmt.itemUrl(siteBase, item.id) : '');
</script>

<div class="iwac-vis-intro__voices">
	{#if data.languages.length}
		<div class="iwac-vis-intro__languages">
			<p class="iwac-vis-intro__caption">{labels.byLanguage}</p>
			<ol class="iwac-vis-intro__ledger iwac-vis-intro__ledger--bars">
				{#each data.languages as row, j (row.other ? '' : row.name)}
					<li class="iwac-vis-intro__row iwac-vis-intro__rise" style:--iwac-vis-intro-j={j}>
						<span class="iwac-vis-intro__name">{language(row)}</span>
						<span class="iwac-vis-intro__track" aria-hidden="true"
							><span
								class="iwac-vis-intro__fill"
								style:width="{row.ratio * 100}%"
								style:--iwac-vis-intro-j={j}
							></span></span
						>
						<span class="iwac-vis-intro__num">{fmt.number(row.count)}</span>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
	{#if data.entities.length}
		<div class="iwac-vis-intro__index">
			<p class="iwac-vis-intro__caption">{labels.entities}</p>
			<div class="iwac-vis-intro__groups">
				{#each data.entities as group, g (group.type)}
					<div class="iwac-vis-intro__group iwac-vis-intro__rise" style:--iwac-vis-intro-j={g + 2}>
						<p class="iwac-vis-intro__group-name">
							<span class="iwac-vis-intro__dot {DOT[group.token]}" aria-hidden="true"></span>
							{fmt.entityType(group.type)}
						</p>
						<ol class="iwac-vis-intro__entries">
							{#each group.items as item, k (k)}
								<li class="iwac-vis-intro__entry">
									{#if href(item)}
										<a class="iwac-vis-intro__entry-name" href={href(item)}>{item.title}</a>
									{:else}
										<span class="iwac-vis-intro__entry-name">{item.title}</span>
									{/if}
									{#if item.count}<span class="iwac-vis-intro__num">{fmt.number(item.count)}</span>{/if}
								</li>
							{/each}
						</ol>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
