<?php
namespace IwacVisualizations\Site\BlockLayout;

class PeriodicalsLandscape extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Periodicals Semantic Landscape'; // @translate
    }

    protected function description(): string
    {
        return 'Zoomable map of the Islamic-periodical corpus: every issue placed by the semantic similarity of its table of contents (UMAP over AI embeddings), color-faceted by country or decade. Data is precomputed. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/periodicals-landscape';
    }
}
