<?php
namespace IwacVisualizations\Site\BlockLayout;

class OrgCooccurrence extends AbstractIwacBlockLayout
{
    protected function label(): string
    {
        return 'Islamic Organisations Co-occurrence'; // @translate
    }

    protected function description(): string
    {
        return 'A heatmap of the ideas that cluster around each major West African Islamic organisation (UIB, CNI, COSIM, CSI, FAIB, UMT) in the press: for a chosen organisation, which pairs of words keep turning up together near its name. Data is precomputed from the IWAC articles. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/org-cooccurrence';
    }
}
