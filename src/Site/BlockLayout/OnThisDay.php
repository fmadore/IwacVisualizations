<?php
namespace IwacVisualizations\Site\BlockLayout;

class OnThisDay extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'On This Day'; // @translate
    }

    protected function description(): string
    {
        return 'Items published on today\'s date across the collection\'s decades — newspaper articles and periodical issues with full publication dates. The block removes itself silently when no data is available, so it is safe on a homepage. Data is precomputed from the IWAC dataset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/on-this-day';
    }
}
