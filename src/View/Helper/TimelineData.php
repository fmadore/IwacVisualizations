<?php
declare(strict_types=1);

namespace IwacVisualizations\View\Helper;

use IwacVisualizations\Data\Deployment;
use IwacVisualizations\Timeline\Catalog;
use Laminas\View\Helper\AbstractHelper;

class TimelineData extends AbstractHelper
{
    private $store;
    private $settings;
    private $catalog;

    public function __construct($store, $settings)
    {
        $this->store = $store;
        $this->settings = $settings;
    }

    public function __invoke(): Catalog
    {
        if (!$this->catalog) {
            $directory = rtrim((string) $this->store->getLocalPath(''), '/\\')
                . '/iwac-visualizations'
                . Deployment::generationPath($this->settings->get('iwacvis_last_sync'));
            $config = \HTMLPurifier_Config::createDefault();
            $config->set('HTML.Allowed', 'a[href|title],em,i,strong,b,blockquote,p,br,ul,ol,li,sup,sub');
            $config->set('URI.AllowedSchemes', ['https' => true, 'http' => true, 'mailto' => true]);
            $config->set('Cache.DefinitionImpl', null);
            $purifier = new \HTMLPurifier($config);
            $this->catalog = new Catalog($directory, [$purifier, 'purify']);
        }
        return $this->catalog;
    }
}
