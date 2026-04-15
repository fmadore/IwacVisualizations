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
        return 'Bibliographic references overview: timeline, types, top authors, and top subjects. Data is fetched live from Hugging Face. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/references-overview';
    }
}
