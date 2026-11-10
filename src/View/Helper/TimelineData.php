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
                ? $local . '/' . Deployment::STORE_SUBDIR
                    . Deployment::generationPath($this->settings->get(Deployment::SETTING_LAST_SYNC))
                : dirname(__DIR__, 3) . '/config/no-local-file-store';
            // Built on the first string to purify, not with the catalogue:
            // the embed gallery and the admin block form only list the
            // timelines, and configuring HTML Purifier (its definition is
            // rebuilt per request, uncached) was the cost of doing that.
            $purifier = null;
            $purify = static function (string $html) use (&$purifier): string {
                $purifier ??= self::purifier();
                return $purifier->purify($html);
            };
            $this->catalog = new Catalog($directory, $purify);
        }
        return $this->catalog;
    }

    private static function purifier(): \HTMLPurifier
    {
        $config = \HTMLPurifier_Config::createDefault();
        $config->set('HTML.Allowed', 'a[href|title],em,i,strong,b,blockquote,p,br,ul,ol,li,sup,sub');
        $config->set('URI.AllowedSchemes', ['https' => true, 'http' => true, 'mailto' => true]);
        // Every absolute link leaves the exhibit — mostly for an IWAC
        // item — so it opens in a new tab and the reader keeps their
        // place in the narrative. Fragments and mailto: are untouched.
        $config->set('HTML.TargetBlank', true);
        $config->set('HTML.TargetNoreferrer', false);
        $config->set('Cache.DefinitionImpl', null);
        return new \HTMLPurifier($config);
    }
}
