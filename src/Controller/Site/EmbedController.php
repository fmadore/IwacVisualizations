<?php
namespace IwacVisualizations\Controller\Site;

use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;

/**
 * Standalone embed endpoint for the IWAC page blocks.
 *
 * Each IWAC page block is zero-configuration and only needs a site
 * context (current site + base path) to render — the block templates
 * never read `$block`. That lets us render any single block on its own
 * bare page, suitable for dropping into a third-party site via an
 * `<iframe>`. Because the iframe loads from this same origin, the
 * same-origin `files/iwac-visualizations/` data fetches, the module CSS, and the theme tokens
 * all resolve exactly as they do on a normal site page — no CORS, no
 * cross-origin data copy, no stylesheet collision with the host page.
 *
 * Routes (children of Omeka's `site` route, so `__SITE__` is inherited
 * and the current site / public theme are set):
 *
 *   /s/:site-slug/iwac-embed                 → indexAction (snippet gallery)
 *   /s/:site-slug/iwac-embed/:block          → blockAction (one bare block)
 *   /s/:site-slug/iwac-embed/:block/:panel   → blockAction (one bare panel)
 *
 * Query params honoured by blockAction (all optional):
 *   ?theme=light|dark   force the colour mode (default: light)
 *   ?primary=RRGGBB     override the brand accent (else module default)
 */
class EmbedController extends AbstractActionController
{
    /**
     * Whitelist of embeddable page blocks: slug => human label. The slug
     * doubles as the `common/block-layout/<slug>` partial name, so this
     * map is also the directory traversal guard for the rendered partial.
     */
    const BLOCKS = [
        'collection-overview'  => 'Collection Overview',
        'index-overview'       => 'Index Overview',
        'references-overview'  => 'References Overview',
        'scary-terms'          => 'Scary Terms',
        'topic-explorer'       => 'Topic Explorer',
        'periodicals-overview' => 'Periodicals Overview',
        'semantic-landscape'   => 'Semantic Landscape',
        'sentiment-atlas'      => 'Sentiment Atlas',
        'lexical-metrics'      => 'Press Language',
        'spatial-exploration'  => 'Spatial Exploration',
        'entity-networks'      => 'Entity Networks',
        'compare-newspapers'   => 'Compare Newspapers',
    ];

    /**
     * Snippet gallery: lists every embeddable block with a live preview
     * and a copy-paste `<iframe>` + auto-resize snippet.
     */
    public function indexAction()
    {
        $this->layout()->setTemplate('iwac-visualizations/layout/embed');
        $this->layout()->setVariable('isGallery', true);

        $view = new ViewModel([
            'blocks'   => self::BLOCKS,
            'siteSlug' => $this->currentSite()->slug(),
        ]);
        $view->setTemplate('iwac-visualizations/embed/index');
        return $view;
    }

    /**
     * Render one page block on a bare page for iframe embedding.
     */
    public function blockAction()
    {
        $slug = (string) $this->params()->fromRoute('block', '');
        if (!isset(self::BLOCKS[$slug])) {
            $this->getResponse()->setStatusCode(404);
            $view = new ViewModel();
            $view->setTerminal(true);
            $view->setTemplate('iwac-visualizations/embed/not-found');
            return $view;
        }

        // Single-panel request: an optional :panel segment pins one panel of
        // a multi-panel block. The slug is opaque here (enumerated client-side
        // by embed.js); the route constraint is the only validation. Empty
        // string means a whole-block embed.
        $panel = (string) $this->params()->fromRoute('panel', '');

        // Colour mode: embeds render LIGHT by default, for predictability — an
        // iframe can't read its host page's colour scheme, and the viewer's OS
        // preference is a poor proxy for it (a dark-OS viewer on a light host
        // would otherwise get a dark widget on a light page). ?theme=dark opts
        // into dark; the layout treats anything but 'dark' as light.
        $theme = strtolower((string) $this->params()->fromQuery('theme', ''));
        if ($theme !== 'light' && $theme !== 'dark') {
            $theme = '';
        }

        // Brand accent override: accept a bare or #-prefixed 3/6/8-digit hex.
        $primary = (string) $this->params()->fromQuery('primary', '');
        if ($primary !== '' && preg_match('/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/', $primary)) {
            $primary = '#' . ltrim($primary, '#');
        } else {
            $primary = '';
        }

        $title = self::BLOCKS[$slug];
        if ($panel !== '') {
            $title .= ' — ' . $panel;
        }

        $this->layout()->setTemplate('iwac-visualizations/layout/embed');
        $this->layout()->setVariable('embedTheme', $theme);
        $this->layout()->setVariable('embedPrimary', $primary);
        $this->layout()->setVariable('embedTitle', $title);
        $this->layout()->setVariable('embedPanel', $panel);

        $view = new ViewModel(['slug' => $slug]);
        $view->setTemplate('iwac-visualizations/embed/block');
        return $view;
    }
}
