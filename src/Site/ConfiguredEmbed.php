<?php
declare(strict_types=1);

namespace IwacVisualizations\Site;

use Laminas\View\HelperPluginManager;

/**
 * A configured page block that an embed can still name.
 *
 * The embed route renders a block with no `$block`, which is what keeps it
 * free of page state. A configured block is embeddable anyway when its
 * configuration comes down to one choice from a list the module knows — a
 * Pipeline Explainer preset, a synced timeline. The URL carries that choice
 * in the parameter its registry row names as `embedParam` (`?preset=ocr`,
 * `?timeline=hajj-bf`), and these two methods turn it into what the block's
 * template needs. Anything else an editor sets on the page (a heading level,
 * an opening event) takes its default in an embed.
 *
 * Static, because the embed controller and the snippet gallery have no
 * block instance to ask, only the registry's class name.
 */
interface ConfiguredEmbed
{
    /**
     * Every value the URL may name => its reader-facing (translated) label,
     * in the order the snippet gallery lists them.
     *
     * @return array<string, string>
     */
    public static function embedVariants(HelperPluginManager $helpers): array;

    /**
     * The block template's variables for one named value, or null when the
     * value names nothing renderable (unknown, retired, or its data is not
     * synced) — the embed route answers 404 for null.
     *
     * @return array<string, mixed>|null
     */
    public static function embedVariables(HelperPluginManager $helpers, string $value): ?array;
}
