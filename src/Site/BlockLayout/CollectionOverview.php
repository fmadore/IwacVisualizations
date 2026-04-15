<?php
namespace IwacVisualizations\Site\BlockLayout;

class CollectionOverview extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Collection Overview'; // @translate
    }

    protected function description(): string
    {
        return 'Aggregate visualizations across the entire collection. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/collection-overview';
    }
}
