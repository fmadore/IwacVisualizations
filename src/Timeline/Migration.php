<?php
declare(strict_types=1);

namespace IwacVisualizations\Timeline;

/** Recognise only a known, standalone Knight Lab embed. Never edit surrounding prose. */
final class Migration
{
    public static function replacement(array $block, string $source, string $slug, string $locale): ?array
    {
        if (($block['o:layout'] ?? '') !== 'html') {
            return null;
        }
        $html = $block['o:data']['html'] ?? '';
        if (!is_string($html) || strpos($html, $source) === false) {
            return null;
        }
        $document = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        try {
            $document->loadHTML('<html><body>' . $html . '</body></html>', LIBXML_NONET);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
        $frames = $document->getElementsByTagName('iframe');
        if ($frames->length !== 1) {
            throw new \RuntimeException('Expected exactly one standalone timeline iframe.');
        }
        $frame = $frames->item(0);
        $url = parse_url($frame->getAttribute('src'));
        parse_str($url['query'] ?? '', $query);
        if (($url['host'] ?? '') !== 'cdn.knightlab.com'
            || ($url['path'] ?? '') !== '/libs/timeline3/latest/embed/index.html'
            || ($query['source'] ?? '') !== $source
        ) {
            throw new \RuntimeException('The legacy iframe source has changed.');
        }
        $frame->parentNode->removeChild($frame);
        $empty = static function ($node) use (&$empty): bool {
            foreach ($node->childNodes as $child) {
                if ($child->nodeType === XML_TEXT_NODE && trim($child->textContent) === '') {
                    continue;
                }
                if ($child->nodeType !== XML_ELEMENT_NODE || $child->nodeName !== 'p'
                    || $child->attributes->length || !$empty($child)
                ) {
                    return false;
                }
            }
            return true;
        };
        if (!$empty($document->getElementsByTagName('body')->item(0)) || !empty($block['o:attachment'])) {
            throw new \RuntimeException('Embed shares a block with other content; migrate it manually.');
        }
        $block['o:layout'] = 'iwac-timeline';
        $block['o:data'] = ['timeline' => $slug, 'locale' => $locale, 'layout' => 'narrative', 'start_slide' => 'intro'];
        return $block;
    }
}
