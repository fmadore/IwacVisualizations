<?php
namespace IwacVisualizations;

use Omeka\Module\AbstractModule;

/**
 * IWAC Visualizations module.
 *
 * Asset loading: every block partial in this module enqueues its own
 * stylesheet, CDN libraries, and JS dependencies via $this->headLink /
 * headScript. We deliberately do NOT attach a controller listener that
 * blanket-loads ECharts/MapLibre on every Item and ItemSet view —
 * doing so cost ~600 KB of unused JavaScript on every Article page,
 * even when no Visualizations block was configured. Per-partial
 * loading keeps the cost contained to pages that actually render a
 * block.
 *
 * If you add a new block, mirror the asset-enqueueing pattern from
 * `view/common/resource-page-block-layout/visualizations/person.phtml`
 * or `view/common/block-layout/collection-overview.phtml`.
 */
class Module extends AbstractModule
{
    public function getConfig()
    {
        return include __DIR__ . '/config/module.config.php';
    }
}
