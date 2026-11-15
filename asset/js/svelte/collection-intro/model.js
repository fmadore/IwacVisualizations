/**
 * What the introduction draws, read out of `collection-overview.json`
 * (scripts/generate_collection_overview.py) — pure, no DOM, no formatting.
 *
 * Each chapter's figure is null when the file lacks what it needs, and the
 * chapter then keeps its words and loses only its figure: the file comes
 * from a data release that can be older or newer than the module.
 *
 * Item types. `summary` gives exact totals for articles, references and
 * photographs only. Publications, documents and audiovisual come from
 * `types_over_time`, which counts dated items, so an undated record of those
 * three types is missing from its segment (36 of ~21,000 on 2026-11-14).
 * The ledger therefore shows each type's own count and its share of the
 * total, and never claims the rows add up to it.
 */
import { nameKey, projectCountries } from './geo.js';

const TYPES = [
    // key in types_over_time, exact summary key, --type-* token
    ['article', 'articles', 'article'],
    ['publication', null, 'publication'],
    ['audiovisual', null, 'audiovisual'],
    ['document', null, 'document'],
    ['reference', 'references_count', 'reference'],
    ['image', 'photographs', 'photograph'],
];

/** Raw index type → its --type-entity-* token, in the order the lists read. */
const ENTITY_TYPES = [
    ['Personnes', 'personnes'],
    ['Organisations', 'organisations'],
    ['Sujets', 'sujets'],
    ['Lieux', 'lieux'],
    ['Événements', 'evenements'],
];

const ENTITIES_PER_TYPE = 5;
/** Up to this many languages are all listed; beyond it the tail is pooled. */
const LANGUAGES_LISTED = 12;
const LANGUAGES_KEPT = 10;

/** A finite number, or null: the file is read, not trusted. */
export function num(value) {
    const n = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
}

const positive = (value) => {
    const n = num(value);
    return n !== null && n > 0 ? n : null;
};

const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);

function sum(values) {
    let total = 0;
    for (const v of list(values)) total += num(v) || 0;
    return total;
}

function what(d, s) {
    const dated = obj(obj(d.types_over_time).series_global);
    const types = TYPES.map(([key, exact, token]) => ({
        key,
        token,
        count: (exact && positive(s[exact])) || positive(sum(dated[key])) || 0,
    })).filter((t) => t.count > 0);
    const total = positive(s.total_items) || types.reduce((a, t) => a + t.count, 0);
    if (!total) return null;
    const secondary = [
        { key: 'indexEntries', value: positive(s.index_entries) },
        { key: 'words', value: positive(s.total_words) },
    ].filter((x) => x.value !== null);
    return { total, types: types.map((t) => ({ ...t, share: (t.count / total) * 100 })), secondary };
}

function where(d, s, geo) {
    const rows = list(d.countries)
        .map((c) => ({ name: String(obj(c).name || '').trim(), count: positive(obj(c).total) || 0 }))
        .filter((c) => c.name && c.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (!rows.length) return null;
    const max = rows[0].count;
    const total = rows.reduce((a, c) => a + c.count, 0);
    for (const row of rows) {
        // Four steps of one hue, on the square root of the count: the largest
        // country is several times the next, and a linear ramp would leave
        // all but one in the palest step.
        row.step = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(row.count / max) * 4)));
        row.share = (row.count / total) * 100;
    }
    const byName = new Map(rows.map((r) => [nameKey(r.name), r]));
    return {
        count: positive(s.countries) || rows.length,
        rows,
        map: geo ? projectCountries(geo, byName) : null,
    };
}

function when(d, s) {
    const t = obj(d.timeline);
    const years = list(t.years);
    const totals = list(t.totals);
    const byYear = new Map();
    years.forEach((y, i) => {
        const year = num(y);
        const count = num(totals[i]);
        if (year === null || count === null || count <= 0 || Math.floor(year) !== year) return;
        byYear.set(year, (byYear.get(year) || 0) + count);
    });
    if (!byYear.size) return null;
    const first = Math.min(...byYear.keys());
    const last = Math.max(...byYear.keys());
    const bars = [];
    let peak = null;
    for (let year = first; year <= last; year++) {
        const count = byYear.get(year) || 0;
        bars.push({ year, count });
        // Ties go to the later year: the more recent peak is the one a
        // reader can still look up in the catalogue's growth.
        if (!peak || count >= peak.count) peak = { year, count, index: bars.length - 1 };
    }
    const decades = [];
    for (const bar of bars) {
        const decade = Math.floor(bar.year / 10) * 10;
        let cell = decades[decades.length - 1];
        if (!cell || cell.decade !== decade) {
            cell = { decade, start: bar.year, years: 0, total: 0 };
            decades.push(cell);
        }
        cell.years += 1;
        cell.total += bar.count;
    }
    return {
        first,
        last,
        bars,
        peak,
        decades,
        newspapers: positive(s.newspapers) || positive(obj(d.newspapers).total),
    };
}

function voices(d, s) {
    let languages = list(obj(d.languages).global)
        .map((l) => ({ name: String(obj(l).name || '').trim(), count: positive(obj(l).count) || 0 }))
        .filter((l) => l.name && l.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const languageCount = positive(s.languages) || languages.length;
    if (languages.length > LANGUAGES_LISTED) {
        const rest = languages.slice(LANGUAGES_KEPT);
        languages = languages.slice(0, LANGUAGES_KEPT)
            .concat([{ name: '', other: true, count: rest.reduce((a, l) => a + l.count, 0) }]);
    }
    const top = obj(d.top_entities);
    const entities = ENTITY_TYPES.map(([type, token]) => ({
        type,
        token,
        items: list(top[type])
            .map((e) => ({ id: num(obj(e).o_id), title: String(obj(e).title || '').trim(), count: positive(obj(e).frequency) }))
            .filter((e) => e.title)
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, ENTITIES_PER_TYPE),
    })).filter((group) => group.items.length);
    if (!languages.length && !entities.length) return null;
    const max = languages.length ? Math.max(...languages.map((l) => l.count)) : 0;
    return {
        count: languages.length ? languageCount : null,
        languages: languages.map((l) => ({ ...l, ratio: max ? l.count / max : 0 })),
        entities,
    };
}

/**
 * @param {object} data  collection-overview.json
 * @param {object|null} geo  iwac-countries.geojson, or null when it failed
 */
export function buildModel(data, geo) {
    const d = obj(data);
    const s = obj(d.summary);
    const generated = String(obj(d.metadata).generatedAt || '');
    return {
        what: what(d, s),
        where: where(d, s, geo),
        when: when(d, s),
        voices: voices(d, s),
        asOf: /^\d{4}-\d{2}-\d{2}/.test(generated) ? generated.slice(0, 10) : '',
    };
}
