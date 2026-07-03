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
        return 'Term co-occurrence heatmap for the discursive neighbourhood of major West African Islamic organisations (UIB, CNI, COSIM, CSI, FAIB, UMT): which concepts appear together near the organisation\'s name in the press. Data is precomputed from the IWAC articles subset with a sliding-window scan. No configuration needed.'; // @translate
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/org-cooccurrence';
    }
}
