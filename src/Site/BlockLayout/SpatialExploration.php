<?php
namespace IwacVisualizations\Site\BlockLayout;

class SpatialExploration extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Spatial Exploration'; // @translate
    }

    protected function description(): string
    {
        return 'Interactive world map of every place mentioned in the collection, with country focus and an entity picker (persons, organizations, events, subjects, places) that maps the locations related to the selected entity. Data is precomputed. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/spatial-exploration';
    }
}
