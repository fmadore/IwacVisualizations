<?php
namespace IwacVisualizations\Site\BlockLayout;

class SemanticLandscape extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Semantic Landscape'; // @translate
    }

    protected function description(): string
    {
        return 'Zoomable map of the whole press corpus: every article placed by the semantic similarity of its full text (UMAP over AI embeddings), color-faceted by country, decade, or topic. Data is precomputed. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/semantic-landscape';
    }
}
