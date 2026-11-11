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
            $generationPath = Deployment::generationPath($this->settings->get(Deployment::SETTING_LAST_SYNC));
            $directory = $local !== ''
                ? $local . '/' . Deployment::STORE_SUBDIR . $generationPath
                : dirname(__DIR__, 3) . '/config/no-local-file-store';
            // Purified timelines are kept per generation and per purifier
            // (its version and this configuration), in the work root. A
            // legacy tree with no generation keeps no cache.
            $cacheDirectory = $local !== '' && $generationPath !== ''
                ? (new Deployment($local . '/' . Deployment::STORE_SUBDIR))->timelineCacheDir(basename($generationPath))
                    . '/' . self::purifierFingerprint()
                : null;
            // Built on the first string to purify, not with the catalogue:
            // the embed gallery and the admin block form only list the
            // timelines, and configuring HTML Purifier (its definition is
            // rebuilt per request, uncached) was the cost of doing that.
            $purifier = null;
            $purify = static function (string $html) use (&$purifier): string {
                $purifier ??= self::purifier();
                return $purifier->purify($html);
            };
            $this->catalog = new Catalog($directory, $purify, $cacheDirectory);
        }
        return $this->catalog;
    }

    /**
     * What the timeline's HTML may keep. Every absolute link leaves the
     * exhibit — mostly for an IWAC item — so it opens in a new tab and the
     * reader keeps their place in the narrative. Fragments and mailto: are
     * untouched. Part of the cache key: change it and every cached timeline
     * is purified again.
     */
    private const PURIFIER_CONFIG = [
        'HTML.Allowed' => 'a[href|title],em,i,strong,b,blockquote,p,br,ul,ol,li,sup,sub',
        'URI.AllowedSchemes' => ['https' => true, 'http' => true, 'mailto' => true],
        'HTML.TargetBlank' => true,
        'HTML.TargetNoreferrer' => false,
    ];

    private static function purifier(): \HTMLPurifier
    {
        $config = \HTMLPurifier_Config::createDefault();
        foreach (self::PURIFIER_CONFIG as $key => $value) {
            $config->set($key, $value);
        }
        $config->set('Cache.DefinitionImpl', null);
        return new \HTMLPurifier($config);
    }

    /** The purifier's version and configuration, as a cache directory name. */
    private static function purifierFingerprint(): string
    {
        return substr(hash('sha256', \HTMLPurifier::VERSION . "\n" . json_encode(self::PURIFIER_CONFIG)), 0, 16);
    }
}
