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
        return 'Pairs of near-identical articles printed by different newspapers — syndicated wire copy (PANA, AFP), shared communiqués and reprints — found by comparing how closely articles are worded. Shows which outlets circulated the same copy, with the full pair list. Data is precomputed from the IWAC articles. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/press-reprints';
    }
}
