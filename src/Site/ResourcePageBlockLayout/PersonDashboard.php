<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class PersonDashboard implements ResourcePageBlockLayoutInterface
{
    /**
     * Omeka resource template id for the ``Personnes`` template on
     * islam.zmo.de. The block renders nothing when attached to items
     * from any other template, so admins can safely leave it on the
     * global item template config without breaking non-person pages.
     */
    const PERSONS_TEMPLATE_ID = 5;

    public function getLabel(): string
    {
        return 'Person dashboard'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        $template = $resource->resourceTemplate();
        if (!$template || (int) $template->id() !== self::PERSONS_TEMPLATE_ID) {
            return '';
        }
        return $view->partial('common/resource-page-block-layout/person-dashboard', [
            'resource' => $resource,
        ]);
    }
}
