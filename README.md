# IWAC Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to the [Islam West Africa Collection (IWAC)](https://islam.zmo.de/) using [ECharts](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/).

**Status:** scaffolding. Initial structure is forked from [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations); charts, layouts, and precompute pipeline will be rewritten against IWAC's data.

## Data source

Unlike ResourceVisualizations, which queries a local Omeka S MySQL database, IWAC Visualizations will work with data hosted on **Hugging Face**. The precompute scripts will fetch from the HF dataset and generate JSON files under `asset/data/`.

## Installation

Not yet released. For local development, place this directory under your Omeka S `modules/` folder and activate in **Admin > Modules**.

## Architecture (inherited; to be adapted)

```
IwacVisualizations/
├── Module.php                          # Asset injection (ECharts, MapLibre CDN)
├── config/
│   ├── module.ini                      # Module metadata
│   └── module.config.php               # Resource page block registration
├── src/Site/
│   ├── BlockLayout/                    # Page block layouts
│   └── ResourcePageBlockLayout/        # Resource page block layouts
├── view/common/                        # PHTML templates (async containers)
├── asset/
│   ├── js/                             # Chart builders + orchestrator
│   ├── css/iwac-visualizations.css     # Styles with CSS custom properties
│   └── data/                           # Precomputed JSON (to be populated)
└── scripts/                            # Precompute pipeline (to be rewritten for HF data)
```

## Dependencies

Loaded via CDN:

- [ECharts 6](https://echarts.apache.org/)
- [echarts-wordcloud 2](https://github.com/ecomfe/echarts-wordcloud)
- [MapLibre GL 5](https://maplibre.org/)

## License

MIT
