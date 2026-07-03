<?php
namespace IwacVisualizations\Site\BlockLayout;

class PressReprints extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Press Reprints'; // @translate
    }

    protected function description(): string
    {
        return 'Near-duplicate article pairs across different newspapers — syndicated wire copy (PANA, AFP), shared communiqués and straight reprints, detected via text-embedding similarity. Shows which outlets circulated the same copy, with the full pair list. Data is precomputed from the IWAC articles subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/press-reprints';
    }
}
