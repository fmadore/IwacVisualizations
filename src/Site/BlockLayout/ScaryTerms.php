<?php
namespace IwacVisualizations\Site\BlockLayout;

class ScaryTerms extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Scary Terms'; // @translate
    }

    protected function description(): string
    {
        return 'Radical / extremism-related terms across the IWAC collection in seven views: an animated bar-chart race, time trends with historical-event markers, by country, global, a co-occurrence matrix, a word cloud of the surrounding vocabulary, and a map of the places mentioned. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/scary-terms';
    }
}
