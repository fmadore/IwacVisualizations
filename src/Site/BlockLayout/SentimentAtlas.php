<?php
namespace IwacVisualizations\Site\BlockLayout;

class SentimentAtlas extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Sentiment Atlas'; // @translate
    }

    protected function description(): string
    {
        return 'AI sentiment atlas of the newspaper articles: polarity, centrality of Islam and subjectivity over time and by country as rated by three language models, plus cross-model agreement. All figures are AI-generated assessments precomputed from the IWAC articles subset. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/sentiment-atlas';
    }
}
