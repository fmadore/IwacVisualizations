<?php
declare(strict_types=1);

/**
 * Just enough of Omeka's item representations for the timeline's source list
 * (IwacVisualizations\Timeline\Sources::cards()): the `api` view helper's
 * search(), and the item and value methods it reads. Shared by the PHP tests
 * and the browser fixture renderer, so both drive the production code.
 */

namespace IwacVisualizations\Tests;

final class FakeValue
{
    private $text;
    private $resource;

    public function __construct(string $text, ?FakeItem $resource = null)
    {
        $this->text = $text;
        $this->resource = $resource;
    }

    public function valueResource() { return $this->resource; }
    public function value() { return $this->resource ? null : $this->text; }
    public function uri() { return null; }
}

final class FakeItem
{
    private $id;
    private $title;
    private $values;
    private $thumbnail;

    /** @param array<string, FakeValue[]> $values term => values */
    public function __construct(int $id, string $title, array $values = [], ?string $thumbnail = null)
    {
        $this->id = $id;
        $this->title = $title;
        $this->values = $values;
        $this->thumbnail = $thumbnail;
    }

    public function id() { return $this->id; }
    public function displayTitle() { return $this->title; }
    public function url() { return '/s/westafrica/item/' . $this->id; }
    public function thumbnailDisplayUrl($type) { return $this->thumbnail; }

    public function value($term, array $options = [])
    {
        $values = $this->values[$term] ?? [];
        return !empty($options['all']) ? $values : ($values[0] ?? null);
    }
}

/** The `api` view helper: search('items', ['id' => […]]) over a fixed set, as an anonymous visitor sees it. */
final class FakeApi
{
    /** @var FakeItem[] */
    private $items;
    /** @var array[] every query search() was given */
    public $queries = [];

    /** @param FakeItem[] $items the items a visitor may read */
    public function __construct(array $items)
    {
        $this->items = $items;
    }

    public function search($resource, $data = [])
    {
        $this->queries[] = [$resource, $data];
        $ids = array_map('intval', (array) ($data['id'] ?? []));
        $found = array_values(array_filter($this->items, static function (FakeItem $item) use ($ids) {
            return in_array($item->id(), $ids, true);
        }));
        return new class($found) {
            private $content;
            public function __construct(array $content) { $this->content = $content; }
            public function getContent() { return $this->content; }
        };
    }
}
