<?php
declare(strict_types=1);

namespace IwacVisualizations\Service\ViewHelper;

use IwacVisualizations\View\Helper\TimelineData;
use Laminas\ServiceManager\Factory\FactoryInterface;
use Psr\Container\ContainerInterface;

class TimelineDataFactory implements FactoryInterface
{
    public function __invoke(ContainerInterface $services, $requestedName, ?array $options = null)
    {
        return new TimelineData($services->get('Omeka\File\Store'), $services->get('Omeka\Settings'));
    }
}
