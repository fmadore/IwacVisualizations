<?php
namespace IwacVisualizations\Service\Controller\Admin;

use Interop\Container\ContainerInterface;
use IwacVisualizations\Controller\Admin\DataController;
use Laminas\ServiceManager\Factory\FactoryInterface;

/**
 * Injects the Omeka file store so the admin page can read the synced
 * corpus-health.json (ROADMAP 9.10) from files/iwac-visualizations/
 * without reaching into the service manager at dispatch time.
 */
class DataControllerFactory implements FactoryInterface
{
    public function __invoke(ContainerInterface $services, $requestedName, ?array $options = null)
    {
        return new DataController($services->get('Omeka\File\Store'));
    }
}
