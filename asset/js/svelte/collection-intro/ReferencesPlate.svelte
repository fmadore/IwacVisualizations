<script>
	// The scholarship it gathers: the bibliography by decade of publication,
	// as columns that rise left to right with each decade's count over its
	// column, then by type, as a ledger with proportional bars. Distinct from
	// "The years it covers", which counts the sources by their own date:
	// this counts what scholars wrote, when. The columns and bars are
	// decoration (aria-hidden); every count and label is text.
	//
	// Type names are the dataset's French labels, translated through the
	// module's one table (iwac-i18n.js: `ref_type_*`), as the References
	// Overview shows them.
	let { data, labels, fmt } = $props();

	function typeName(row) {
		if (row.other) return labels.otherTypes;
		const key = 'ref_type_' + row.name;
		const label = fmt.t(key);
		return label && label !== key ? label : row.name;
	}

	/** What the tick under a column shows: its first year, or its span. */
	function tick(cell) {
		if (cell.before) return labels.before.replace('{year}', String(cell.before));
		if (cell.end) return `${cell.decade}–${String(cell.end).slice(-2)}`;
		return String(cell.decade);
	}

	/** What a screen reader hears for that column. */
	function spoken(cell) {
		if (cell.before) return labels.before.replace('{year}', String(cell.before));
		if (cell.end) return `${cell.decade}–${cell.end}`;
		return labels.decade.replace('{decade}', String(cell.decade));
	}
</script>

<div class="iwac-vis-intro__scholarship">
	{#if data.decades.length}
		<div class="iwac-vis-intro__by-decade">
			<p class="iwac-vis-intro__caption">{labels.refsByDecade}</p>
			<ol class="iwac-vis-intro__columns">
				{#each data.decades as cell, j (cell.decade)}
					<li class="iwac-vis-intro__column">
						<span class="iwac-vis-intro__num iwac-vis-intro__rise" style:--iwac-vis-intro-j={j}
							>{fmt.number(cell.count)}</span
						>
						<span class="iwac-vis-intro__column-track" aria-hidden="true"
							><span
								class="iwac-vis-intro__column-fill"
								style:height="{cell.ratio * 100}%"
								style:--iwac-vis-intro-j={j}
							></span></span
						>
						<span class="iwac-vis-intro__tick" aria-hidden="true">{tick(cell)}</span>
						<span class="iwac-vis-intro__sr">{spoken(cell)}</span>
					</li>
				{/each}
			</ol>
			{#if data.undated}
				<p class="iwac-vis-intro__axis-note">{labels.undated.replace('{count}', fmt.number(data.undated))}</p>
			{/if}
		</div>
	{/if}
	{#if data.types.length}
		<div class="iwac-vis-intro__by-type">
			<p class="iwac-vis-intro__caption">{labels.refsByType}</p>
			<ol class="iwac-vis-intro__ledger iwac-vis-intro__ledger--bars">
				{#each data.types as row, j (row.other ? '' : row.name)}
					<li class="iwac-vis-intro__row iwac-vis-intro__rise" style:--iwac-vis-intro-j={j + 2}>
						<span class="iwac-vis-intro__name">{typeName(row)}</span>
						<span class="iwac-vis-intro__track" aria-hidden="true"
							><span
								class="iwac-vis-intro__fill"
								style:width="{row.ratio * 100}%"
								style:--iwac-vis-intro-j={j + 2}
							></span></span
						>
						<span class="iwac-vis-intro__num">{fmt.number(row.count)}</span>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>
