<?php
namespace IwacVisualizations\Site\BlockLayout;

class TermTrends extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Term Trends'; // @translate
    }

    protected function description(): string
    {
        return 'The IWAC "Ngram viewer": plot the per-year share of articles whose full text contains any frequent term. Search the vocabulary, overlay up to eight terms, switch between share and absolute counts. Data is precomputed from the articles subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/term-trends';
    }
}
