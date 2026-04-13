<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

/**
 * Single resource page block that branches by item resource template.
 *
 * Each supported template renders its own partial under
 * view/common/resource-page-block-layout/visualizations/. Items whose
 * template is not in the map produce no output, so admins can wire
 * this block up once for "all items" without breaking unrelated pages.
 *
 * Add a new dashboard by appending a `template_id => 'partial-name'`
 * entry to TEMPLATE_PARTIALS and creating the matching .phtml file.
 */
class Visualizations implements ResourcePageBlockLayoutInterface
{
    /**
     * Map of resource template ids on islam.zmo.de to the partial name
     * (relative to common/resource-page-block-layout/visualizations/).
     *
     * Persons get a dedicated partial because the role facet (subject
     * vs creator) is meaningful only for them. The four non-person
     * entity types share `entity.phtml`, which renders the same panel
     * set without a facet bar and reads from the precomputed JSON
     * shape that generate_entity_dashboards.py emits.
     */
    const TEMPLATE_PARTIALS = [
        5 => 'person', // Personnes
        6 => 'entity', // Lieux
        7 => 'entity', // Organisations
        3 => 'entity', // Sujets
        2 => 'entity', // Événements
    ];

    public function getLabel(): string
    {
        return 'Visualizations'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        $template = $resource->resourceTemplate();
        if (!$template) {
            return '';
        }

        $partial = self::TEMPLATE_PARTIALS[(int) $template->id()] ?? null;
        if ($partial === null) {
            return '';
        }

        return $view->partial(
            'common/resource-page-block-layout/visualizations/' . $partial,
            ['resource' => $resource]
        );
    }
}
