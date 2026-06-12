<?php
namespace IwacVisualizations\Site\BlockLayout;

class EntityNetworks extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Entity Networks'; // @translate
    }

    protected function description(): string
    {
        return 'Co-occurrence networks across the collection: an entity graph linking persons, organizations, events, subjects and places that appear in the same items (layout precomputed), and a geographic network of co-mentioned places drawn over the basemap. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/entity-networks';
    }
}
