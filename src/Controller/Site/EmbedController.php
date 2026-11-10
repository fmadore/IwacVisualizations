<?php
declare(strict_types=1);

namespace IwacVisualizations\Controller\Site;

use IwacVisualizations\Site\BlockRegistry;
use IwacVisualizations\Site\EmbedBrand;
use IwacVisualizations\Site\ResourcePageBlockLayout\ItemSetDashboard;
use IwacVisualizations\Site\ResourcePageBlockLayout\Visualizations;
use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;
use Omeka\Api\Exception\NotFoundException;
use Omeka\Api\Exception\PermissionDeniedException;

/**
 * Standalone embed endpoint for the IWAC visualisations.
 *
 * The page blocks render without `$block` — the zero-configuration ones read
 * only a site context (current site + base path), and the two configured ones
 * read the one choice their URL names (`ConfiguredEmbed`). That lets us render
 * any single block on its own bare page, suitable for dropping into a
 * third-party site via an `<iframe>`. The per-item dashboards render the same
 * way from the resource the URL names. Because the iframe loads from this same
 * origin, the same-origin `files/iwac-visualizations/` data fetches, the
 * module CSS, and the theme tokens all resolve exactly as they do on a normal
 * site page — no CORS, no cross-origin data copy, no stylesheet collision
 * with the host page.
 *
 * Routes (children of Omeka's `site` route, so `__SITE__` is inherited
 * and the current site / public theme are set):
 *
 *   /s/:site-slug/iwac-embed                       → indexAction (snippet gallery)
 *   /s/:site-slug/iwac-embed/:block                → blockAction (one bare block)
 *   /s/:site-slug/iwac-embed/:block/:panel         → blockAction (one bare panel)
 *   /s/:site-slug/iwac-embed/item/:id[/:panel]     → resourceAction (an item's dashboard)
 *   /s/:site-slug/iwac-embed/item-set/:id[/:panel] → resourceAction (an item set's)
 *
 * Query params honoured by blockAction and resourceAction (all optional):
 *   ?theme=light|dark   force the colour mode (default: light)
 *   ?primary=RRGGBB     a brand SEED to derive the accent from, as the theme
 *                       derives its own (EmbedBrand); the theme's stock seed
 *                       overrides nothing
 *   ?<embedParam>=…     a configured block's choice (`?preset=ocr`), required
 *   ?<prefix>.<key>=…   a block's view state, read by the block's own script
 *                       (`?laicite.view=trends`) — the server ignores it
 */
class EmbedController extends AbstractActionController
{
    /** The resource route segment => its API resource name. */
    const RESOURCES = [
        'item'     => 'items',
        'item-set' => 'item_sets',
    ];

    /**
     * Whitelist of embeddable page blocks: slug => human label.
     *
     * Derived from `BlockRegistry`, which is also what the block classes and
     * the block lint read — this used to be a hand-maintained second copy of
     * every label, and the copy that drifted (v1.21's `press-reprints-detector`
     * slug, which 500'd every embed of that block).
     *
     * The slug selects the rendered partial (`BlockRegistry::partialFor()`),
     * so this map is also the directory-traversal guard for it.
     */
    private static function blocks(): array
    {
        return BlockRegistry::embeddable();
    }

    /**
     * Snippet gallery: lists every embeddable block with a live preview
     * and a copy-paste `<iframe>` + auto-resize snippet. A configured block
     * is listed once per choice — each Pipeline Explainer preset, each
     * synced timeline.
     */
    public function indexAction()
    {
        $this->layout()->setTemplate('iwac-visualizations/layout/embed');
        $this->layout()->setVariable('isGallery', true);

        $cards = [];
        foreach (self::blocks() as $slug => $label) {
            $param = BlockRegistry::embedParam($slug);
            if ($param === null) {
                $cards[] = ['slug' => $slug, 'label' => $label, 'variant' => '', 'query' => []];
                continue;
            }
            $class = BlockRegistry::get($slug)['class'];
            foreach ($class::embedVariants($this->viewHelpers()) as $value => $variant) {
                $cards[] = ['slug' => $slug, 'label' => $label, 'variant' => $variant, 'query' => [$param => $value]];
            }
        }

        $view = new ViewModel([
            'cards'    => $cards,
            'siteSlug' => $this->currentSite()->slug(),
        ]);
        $view->setTemplate('iwac-visualizations/embed/index');
        $this->cacheable();
        return $view;
    }

    /**
     * Let a response be cached for five minutes — by the viewer's browser.
     *
     * Embeds are read-only and fetched by third-party pages this module does
     * not control — a slide deck, a project site, a lecture page. Without a
     * `Cache-Control` header every view of those hits Omeka's full bootstrap.
     * Five minutes is short enough that a data sync shows up promptly and
     * long enough to absorb a page that embeds several panels of one block.
     *
     * `private`, not `public`: Omeka starts a session on a site route, so
     * these responses carry `Set-Cookie`, and `public` invited a shared cache
     * (a proxy, a CDN) to store one visitor's session cookie and hand it to
     * the next (V-15). The browser cache keeps the saving that matters.
     */
    private function cacheable(): void
    {
        $this->getResponse()->getHeaders()
            ->addHeaderLine('Cache-Control', 'private, max-age=300');
    }

    /** The bare 404 page an unknown block, choice or resource gets. */
    private function notFound(): ViewModel
    {
        $this->getResponse()->setStatusCode(404);
        $view = new ViewModel();
        $view->setTerminal(true);
        $view->setTemplate('iwac-visualizations/embed/not-found');
        return $view;
    }

    /**
     * Put the bare embed layout around the response, with the colour mode
     * and accent the query asks for, the frame's `<title>`, and the pinned
     * panel when the URL names one.
     */
    private function frame(string $title): void
    {
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

        // Brand accent override: a bare or #-prefixed 3/6/8-digit hex, by the
        // one rule the layout derives the accent with; anything else is ''.
        $primary = EmbedBrand::normalize((string) $this->params()->fromQuery('primary', ''));

        if ($panel !== '') {
            $title .= ' — ' . $panel;
        }

        $this->layout()->setTemplate('iwac-visualizations/layout/embed');
        $this->layout()->setVariable('embedTheme', $theme);
        $this->layout()->setVariable('embedPrimary', $primary);
        $this->layout()->setVariable('embedTitle', $title);
        $this->layout()->setVariable('embedPanel', $panel);
        $this->cacheable();
    }

    /**
     * Render one page block on a bare page for iframe embedding.
     */
    public function blockAction()
    {
        $slug = (string) $this->params()->fromRoute('block', '');
        $blocks = self::blocks();
        if (!isset($blocks[$slug])) {
            return $this->notFound();
        }

        // The registry's labels are English source strings (`// @translate`);
        // the French site's tab title read "Collection Overview".
        $title = $this->translate($blocks[$slug]);

        // A configured block renders the choice its URL names, and nothing
        // else: no default preset for a typo, no first timeline for a
        // missing one.
        $variables = [];
        $param = BlockRegistry::embedParam($slug);
        if ($param !== null) {
            $value = (string) $this->params()->fromQuery($param, '');
            $class = BlockRegistry::get($slug)['class'];
            $variables = $value === '' ? null : $class::embedVariables($this->viewHelpers(), $value);
            if ($variables === null) {
                return $this->notFound();
            }
            $title .= ' — ' . ($class::embedVariants($this->viewHelpers())[$value] ?? $value);
        }

        $this->frame($title);
        $view = new ViewModel(['slug' => $slug, 'variables' => $variables]);
        $view->setTemplate('iwac-visualizations/embed/block');
        return $view;
    }

    /**
     * Render an item's (or an item set's) Visualisations dashboard on a bare
     * page — the one its page shows, under the resource's title.
     *
     * The API read applies Omeka's visibility rules: a private resource is
     * not found for a visitor who could not see its page either. A resource
     * whose template has no dashboard is a 404 too, rather than an empty
     * frame.
     */
    public function resourceAction()
    {
        $type = (string) $this->params()->fromRoute('resource', '');
        $id = (int) $this->params()->fromRoute('id', 0);
        if (!isset(self::RESOURCES[$type]) || $id < 1) {
            return $this->notFound();
        }
        try {
            $resource = $this->api()->read(self::RESOURCES[$type], $id)->getContent();
        } catch (NotFoundException | PermissionDeniedException $e) {
            return $this->notFound();
        }
        $partial = $type === 'item' ? Visualizations::partialFor($resource) : ItemSetDashboard::PARTIAL;
        if ($partial === null) {
            return $this->notFound();
        }

        $this->frame((string) $resource->displayTitle());
        $view = new ViewModel(['partial' => $partial, 'resource' => $resource]);
        $view->setTemplate('iwac-visualizations/embed/resource');
        return $view;
    }
}
