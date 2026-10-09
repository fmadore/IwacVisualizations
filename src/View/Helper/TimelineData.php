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
            // Only a local file store has a directory to read. A remote one
            // (an S3 adapter, say) has no getLocalPath(), and calling it
            // fatalled every page carrying a timeline block; such a site has
            // no synced data on disk either, so the catalogue is empty.
            $local = is_object($this->store) && method_exists($this->store, 'getLocalPath')
                ? rtrim((string) $this->store->getLocalPath(''), '/\\')
                : '';
            $directory = $local !== ''
                ? $local . '/iwac-visualizations'
                    . Deployment::generationPath($this->settings->get('iwacvis_last_sync'))
                : dirname(__DIR__, 3) . '/config/no-local-file-store';
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
