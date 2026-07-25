<?php
namespace IwacVisualizations\Site\BlockLayout;

use IwacVisualizations\Site\BlockRegistry;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

/**
 * Shared scaffolding for IWAC page blocks.
 *
 * Every IWAC block is zero-configuration: form() renders a description,
 * render() calls a template partial with the block as the only argument.
 * A subclass supplies its slug and nothing else — label, description and
 * partial path all resolve through `BlockRegistry`, which is also what the
 * embed controller and the block lint read. Before v1.23.0 each subclass
 * carried its own copy of the label and description, and the embed
 * controller carried a second copy of the label.
 */
abstract class AbstractIwacBlockLayout extends AbstractBlockLayout
{
    /**
     * Registry slug. Also the partial name and the embed route segment.
     * Declared by every subclass; `const` rather than a method so it reads
     * as the piece of identity it is.
     */
    const SLUG = '';

    /**
     * The registry row for this block. Throws on an unregistered slug —
     * loudly at block-render time rather than as a blank block, and
     * `npm run lint:blocks` catches it long before that.
     */
    protected function row(): array
    {
        $row = BlockRegistry::get(static::SLUG);
        if ($row === null) {
            throw new \LogicException(sprintf(
                '%s declares slug "%s", which is not in BlockRegistry::BLOCKS.',
                static::class,
                static::SLUG
            ));
        }
        return $row;
    }

    public function getLabel()
    {
        return $this->row()['label'];
    }

    protected function templateViewScript(): string
    {
        return 'common/block-layout/' . static::SLUG;
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate($this->row()['description']) . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = null)
    {
        return $view->partial($templateViewScript ?: $this->templateViewScript(), [
            'block' => $block,
        ]);
    }
}
