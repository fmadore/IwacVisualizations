<?php
namespace IwacVisualizations\Site\BlockLayout;

class PressBylines extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Press Bylines'; // @translate
    }

    protected function description(): string
    {
        return 'Who signed the press: byline coverage over time and the most prolific journalists and press agencies, with active spans and frequent subjects, linked to their authority records where they exist. Data is precomputed from the IWAC articles subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/press-bylines';
    }
}
