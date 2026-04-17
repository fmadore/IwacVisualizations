<?php
namespace IwacVisualizations\Site\BlockLayout;

class CompareNewspapers extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Compare Newspapers'; // @translate
    }

    protected function description(): string
    {
        return 'Side-by-side comparison of two newspaper corpora (articles or Islamic publications), scoped either to a whole country or a single newspaper. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/compare-newspapers';
    }
}
