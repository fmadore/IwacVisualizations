<?php
namespace IwacVisualizations\Site\BlockLayout;

class CompareProjects extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Compare Projects'; // @translate
    }

    protected function description(): string
    {
        return 'Side-by-side comparison of two projects. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/compare-projects';
    }
}
