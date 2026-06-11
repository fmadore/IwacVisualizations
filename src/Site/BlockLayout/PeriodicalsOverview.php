<?php
namespace IwacVisualizations\Site\BlockLayout;

class PeriodicalsOverview extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Periodicals Overview'; // @translate
    }

    protected function description(): string
    {
        return 'Islamic periodicals overview: publication runs, issues per year by country, languages, countries, and top subjects. Data is precomputed from the IWAC publications subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/periodicals-overview';
    }
}
