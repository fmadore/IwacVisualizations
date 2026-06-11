<?php
namespace IwacVisualizations\Site\BlockLayout;

class LexicalMetrics extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Press Language'; // @translate
    }

    protected function description(): string
    {
        return 'Press language metrics of the newspaper articles: readability (Flesch), lexical richness (type-token ratio) and article length over time, with newspapers ranked by readability and richness. Data is precomputed from the OCR text of the IWAC articles subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/lexical-metrics';
    }
}
