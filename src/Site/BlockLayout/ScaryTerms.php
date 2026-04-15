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
        return 'Bar chart of radical / extremism-related terms across the IWAC collection, with bar chart race, by-country, and global views. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/scary-terms';
    }
}
