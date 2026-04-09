# IWAC Visualizations — Roadmap

Initial scaffold lifted from [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations). This roadmap will be rewritten once IWAC-specific requirements are clearer.

## Immediate next steps

- [ ] Survey IWAC's data on Hugging Face: entity types, properties, volume, relationships
- [ ] Decide which of the inherited chart builders apply to IWAC and remove the rest
- [ ] Rewrite the precompute pipeline to fetch from Hugging Face instead of MySQL
- [ ] Define IWAC-specific dashboard layouts per resource template
- [ ] Adapt the knowledge graph categories/property mapping to IWAC's ontology

## Inherited visualizations (from ResourceVisualizations)

Full chart library is present under `asset/js/dashboard-charts-*.js`. These will be pruned or reworked:

- Timeline, stacked timeline, Gantt, beeswarm
- Pie, bar, wordcloud
- Heatmap, chord, sankey, sunburst, treemap, stacked area
- Map (origins), geo flows (origin → current location)
- Contributor network, collaboration network
