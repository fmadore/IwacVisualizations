<?php
declare(strict_types=1);

namespace IwacVisualizations\Mvc;

use Laminas\Http\Response;
use Laminas\Mvc\MvcEvent;

/**
 * Make the /iwac-embed routes framable from any origin.
 *
 * Split out of Module.php (Tier 8 / H4), which carried four unrelated
 * concerns and ~100 lines of this one: ACL grants, the sentiment
 * vocabulary, the display-values listener, and header rewriting. Header
 * rewriting is the largest and the least like the others - it is HTTP
 * plumbing with its own parsing rules, and the only part with pure
 * functions worth testing on their own.
 *
 * WHAT IT DOES AND WHY IT IS NOT SIMPLER
 * --------------------------------------
 * The embed is a public, read-only widget meant for slide decks, project
 * sites and blog posts, so any parent may frame it. `X-Frame-Options`
 * cannot express that - it understands only DENY and SAMEORIGIN - so a
 * SAMEORIGIN hardening default (common in nginx) renders the iframe blank
 * on every other origin. It is removed, and `frame-ancestors` is rewritten
 * inside every enforced CSP policy instead.
 *
 * REWRITTEN, not appended: multiple CSP headers are applied as an
 * INTERSECTION, so adding a permissive second header cannot relax an
 * existing `frame-ancestors 'self'`. Every unrelated directive is
 * preserved.
 *
 * Effective only for headers set by Omeka/PHP. If the reverse proxy adds
 * `X-Frame-Options ... always`, that overrides PHP and must be relaxed for
 * the /iwac-embed path there too - but this CSP is then already in place,
 * so only the X-Frame-Options removal is left to do.
 */
class EmbedFramingListener
{
    /**
     * Rewrite the framing headers on the /iwac-embed routes.
     *
     * Scoped by matched route name prefix `site/iwac-embed`, so normal site
     * pages keep whatever framing policy the site or the proxy sets.
     */
    public function __invoke(MvcEvent $event): void
    {
        $match = $event->getRouteMatch();
        if (!$match || strpos((string) $match->getMatchedRouteName(), 'site/iwac-embed') !== 0) {
            return;
        }
        $response = $event->getResponse();
        if (!$response instanceof Response) {
            return;
        }
        $headers = $response->getHeaders();
        foreach (self::responseHeadersNamed($headers, 'X-Frame-Options') as $header) {
            $headers->removeHeader($header);
        }
        // Public read-only widget — any parent may frame it. Every enforced
        // CSP policy must allow the parent: multiple CSP headers are applied
        // as an intersection, so appending a permissive second header cannot
        // relax an existing `frame-ancestors 'self'`. Rewrite the directive
        // in each policy while preserving every unrelated directive.
        $cspHeaders = self::responseHeadersNamed($headers, 'Content-Security-Policy');
        $policies = [];
        foreach ($cspHeaders as $header) {
            $policies[] = $header->getFieldValue();
            $headers->removeHeader($header);
        }
        foreach (self::relaxFrameAncestorsPolicies($policies) as $policy) {
            $headers->addHeaderLine('Content-Security-Policy', $policy);
        }
    }

    /**
     * Return every response header with the requested field name.
     *
     * Laminas HTTP versions bundled with Omeka S 4.0 treat generic headers
     * such as Content-Security-Policy as single-value in Headers::get(), even
     * when the response contains the field more than once. Iterating the
     * container is the version-neutral way to reach and rewrite every enforced
     * policy (and every X-Frame-Options line).
     */
    private static function responseHeadersNamed($headers, string $fieldName): array
    {
        $matches = [];
        foreach ($headers as $header) {
            if (strcasecmp($header->getFieldName(), $fieldName) === 0) {
                $matches[] = $header;
            }
        }
        return $matches;
    }

    /**
     * Return CSP header values with every enforced policy allowing framing.
     * Kept pure so multiple-policy composition is covered without booting MVC.
     */
    public static function relaxFrameAncestorsPolicies(array $headerValues): array
    {
        if (!$headerValues) {
            return ['frame-ancestors *'];
        }
        return array_map([self::class, 'relaxFrameAncestorsPolicy'], $headerValues);
    }

    /** Rewrite frame-ancestors within one CSP header value. */
    private static function relaxFrameAncestorsPolicy(string $headerValue): string
    {
        // A field value may contain a comma-separated CSP policy list. A comma
        // followed by a directive name starts another policy; ordinary source
        // expressions do not use that shape.
        $policyValues = preg_split(
            '/\s*,\s*(?=[A-Za-z][A-Za-z0-9-]*\s)/',
            trim($headerValue)
        );
        $relaxed = [];
        foreach ($policyValues ?: [''] as $policyValue) {
            $directives = array_values(array_filter(
                array_map('trim', explode(';', $policyValue)),
                static function (string $directive): bool {
                    return $directive !== '';
                }
            ));
            $rewritten = [];
            $inserted = false;
            foreach ($directives as $directive) {
                if (preg_match('/^frame-ancestors(?:\s|$)/i', $directive)) {
                    if (!$inserted) {
                        $rewritten[] = 'frame-ancestors *';
                        $inserted = true;
                    }
                    continue;
                }
                $rewritten[] = $directive;
            }
            if (!$inserted) {
                $rewritten[] = 'frame-ancestors *';
            }
            $relaxed[] = implode('; ', $rewritten);
        }
        return implode(', ', $relaxed);
    }
}
