<?php
namespace IwacVisualizations\Site\BlockLayout;

class IndexOverview extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Index Overview'; // @translate
    }

    protected function description(): string
    {
        return 'Explore authority entities (persons, places, organisations, events, topics) and Dublin Core Subject + Spatial Coverage prevalence over time. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/index-overview';
    }
}
