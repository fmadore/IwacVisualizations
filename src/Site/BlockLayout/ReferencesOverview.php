<?php
namespace IwacVisualizations\Site\BlockLayout;

class ReferencesOverview extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'References Overview'; // @translate
    }

    protected function description(): string
    {
        return 'Bibliographic references overview: timeline, types, languages, countries, top authors and subjects, country-by-type treemap, and co-authorship network. Data is precomputed from the IWAC references subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/references-overview';
    }
}
