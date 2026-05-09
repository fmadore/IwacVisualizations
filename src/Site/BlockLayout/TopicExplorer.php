<?php
namespace IwacVisualizations\Site\BlockLayout;

class TopicExplorer extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Topic Explorer'; // @translate
    }

    protected function description(): string
    {
        return 'LDA-30 topic overview of the IWAC articles subset, with a treemap of all topics and a per-topic drill-down (calendar heatmap, country / newspaper distributions, most-representative articles). No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/topic-explorer';
    }
}
