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

    public function addAssets($event)
    {
        $view = $event->getTarget();
        $view->headLink()->appendStylesheet(
            $view->assetUrl('css/iwac-visualizations.css', 'IwacVisualizations')
        );
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
        $view->headScript()->appendFile(
            $view->assetUrl('js/dashboard-core.js', 'IwacVisualizations')
        );
    }
}
