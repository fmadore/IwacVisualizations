<?php
namespace IwacVisualizations;

use Omeka\Module\AbstractModule;
use Laminas\EventManager\SharedEventManagerInterface;

class Module extends AbstractModule
{
    public function getConfig()
    {
        return include __DIR__ . '/config/module.config.php';
    }

    public function attachListeners(SharedEventManagerInterface $sharedEventManager)
    {
        $sharedEventManager->attach(
            'Omeka\Controller\Site\Item',
            'view.show.before',
            [$this, 'addAssets']
        );
        $sharedEventManager->attach(
            'Omeka\Controller\Site\ItemSet',
            'view.show.before',
            [$this, 'addAssets']
        );
    }

    /**
     * Inject stylesheet, ECharts/MapLibre CDN assets, and the IWAC
     * theme/i18n helpers on item and item-set pages. Block layouts
     * used on site pages enqueue the same assets from their templates
     * because this listener does not fire on page controllers.
     */
    public function addAssets($event)
    {
        $view = $event->getTarget();

        // Module stylesheet
        $view->headLink()->appendStylesheet(
            $view->assetUrl('css/iwac-visualizations.css', 'IwacVisualizations')
        );

        // ECharts + MapLibre via CDN
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js'
        );
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js'
        );
        $view->headLink()->appendStylesheet(
            'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css'
        );
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js'
        );

        // IWAC infrastructure — order matters: i18n → theme → core
        $view->headScript()->appendFile(
            $view->assetUrl('js/iwac-i18n.js', 'IwacVisualizations')
        );
        $view->headScript()->appendFile(
            $view->assetUrl('js/iwac-theme.js', 'IwacVisualizations')
        );
        $view->headScript()->appendFile(
            $view->assetUrl('js/dashboard-core.js', 'IwacVisualizations')
        );
    }
}
