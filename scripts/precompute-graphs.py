#!/usr/bin/env python3
"""
Pre-compute knowledge graph JSON files for all Omeka S items.

Uses `docker compose exec` to query MySQL — no port exposure needed.

Usage:
  python3 scripts/precompute-graphs.py

Set OMEKA_DOCKER_DIR if the omeka-s-docker directory is elsewhere:
  OMEKA_DOCKER_DIR=/path/to/omeka-s-docker python3 scripts/precompute-graphs.py
"""

import json
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'knowledge-graphs')

sys.path.insert(0, SCRIPT_DIR)
from precompute.db import get_password, query_mysql  # noqa: E402

# Properties to include as graph nodes.
PROP_CAT = {
    'dcterms:creator': 'Person', 'dcterms:contributor': 'Person', 'foaf:member': 'Person',
    'dcterms:subject': 'Subject',
    'dcterms:spatial': 'Location', 'dcterms:provenance': 'Location',
    'dcterms:isPartOf': 'Project',
    'dcterms:format': 'Genre',
    'frapo:isFundedBy': 'Institution',
    'dcterms:relation': 'Related Item', 'dcterms:hasPart': 'Related Item',
    'dcterms:replaces': 'Related Item', 'dcterms:isReplacedBy': 'Related Item',
    'dcterms:hasVersion': 'Related Item', 'dcterms:isVersionOf': 'Related Item',
    'dcterms:hasFormat': 'Related Item',
}

SHAREABLE = {
    'dcterms:subject', 'dcterms:isPartOf', 'dcterms:spatial',
    'dcterms:creator', 'dcterms:contributor',
}


def get_category(term):
    if term in PROP_CAT:
        return PROP_CAT[term]
    if term.startswith('marcrel:'):
        return 'Contributor'
    return None


def compute_resource_stats(links, total_items):
    """Compute IDF (Inverse Document Frequency) and frequency percentage for
    every resource that appears as a link target.

    IDF measures how *distinctive* a resource is across the entire corpus:
      idf(r) = ln(N / df(r))
    where N = total items and df(r) = number of distinct items linking to r.

    - High IDF  → rare resource, few items reference it  → distinctive signal
    - Low  IDF  → ubiquitous resource, most items share it → noise

    freq_pct is the plain percentage: df(r) / N * 100.  It powers the
    client-side "max commonality" slider so users can hide connections
    through resources shared by, say, more than 20 % of items.

    Returns:
        idf       – dict {resource_id: float}
        freq_pct  – dict {resource_id: float}  (0–100)
    """
    doc_freq = {}  # resource_id → count of distinct items linking to it
    for item_id, rels in links.items():
        seen_in_item = set()
        for _term, _label, vrid in rels:
            if vrid not in seen_in_item:
                seen_in_item.add(vrid)
                doc_freq[vrid] = doc_freq.get(vrid, 0) + 1

    idf = {}
    freq_pct = {}
    for vrid, df in doc_freq.items():
        idf[vrid] = round(math.log(total_items / df), 2) if df > 0 else 0
        freq_pct[vrid] = round(df / total_items * 100, 1)

    return idf, freq_pct


def load_data(password):
    print('  Loading items...')
    items = {}
    for row in query_mysql("""
        SELECT r.id, r.title, rc.label, CONCAT(v.prefix, ':', rc.local_name)
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """, password):
        items[int(row[0])] = {
            'title': row[1] or f'Item {row[0]}',
            'class_label': row[2] if row[2] != 'NULL' and row[2] else 'Item',
            'class_term': row[3] if row[3] != 'NULL' and row[3] and ':' in row[3] else '',
        }
    print(f'    {len(items)} items')

    print('  Loading relationships...')
    links = {}
    reverse = {}       # for shared-item discovery (shareable terms only)
    all_reverse = {}   # ALL reverse links: target_id -> set of source_ids
    for row in query_mysql("""
        SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), p.label, v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """, password):
        rid, term, label, vrid = int(row[0]), row[1], row[2], int(row[3])
        links.setdefault(rid, []).append((term, label, vrid))
        all_reverse.setdefault(vrid, set()).add(rid)
        if term in SHAREABLE or term.startswith('marcrel:'):
            reverse.setdefault(vrid, set()).add(rid)
    print(f'    {sum(len(v) for v in links.values())} links, {len(all_reverse)} reverse entries')

    print('  Loading geo coordinates...')
    geo = {}
    for row in query_mysql("""
        SELECT r.id, r.title,
               MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:lat' THEN v.value END) AS lat,
               MAX(CASE WHEN CONCAT(vo.prefix, ':', p.local_name) = 'geo:long' THEN v.value END) AS lon
        FROM resource r
        JOIN value v ON v.resource_id = r.id
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) IN ('geo:lat', 'geo:long')
        GROUP BY r.id
        HAVING lat IS NOT NULL AND lon IS NOT NULL
    """, password):
        try:
            geo[int(row[0])] = {
                'name': row[1] or f'Location {row[0]}',
                'lat': float(row[2]), 'lon': float(row[3]),
                'itemId': int(row[0]),
            }
        except (ValueError, TypeError):
            pass
    print(f'    {len(geo)} locations with coordinates')

    return items, links, reverse, all_reverse, geo


MAX_DIRECT_NODES = 150
MAX_REVERSE_NODES = 25
MAX_SHARED_NODES = 60  # raised from 30 — IDF-based ranking ensures quality

# Priority order for direct relationships when capping.
CAT_PRIORITY = ['Person', 'Contributor', 'Subject', 'Project', 'Location', 'Institution', 'Genre', 'Related Item']


MAX_REVERSE_ITEMS = 40  # For entities like subjects/languages: max items shown linking to them


def build_item_map(item_id, links, geo):
    """Extract origin (dcterms:spatial) and current (dcterms:provenance) locations with coordinates."""
    origins = []
    current = []
    seen = set()
    for term, label, vrid in links.get(item_id, []):
        if term not in ('dcterms:spatial', 'dcterms:provenance'):
            continue
        if vrid in seen or vrid not in geo:
            continue
        seen.add(vrid)
        loc = geo[vrid]
        entry = {'name': loc['name'], 'lat': loc['lat'], 'lon': loc['lon'], 'itemId': loc['itemId']}
        if term == 'dcterms:spatial':
            origins.append(entry)
        else:
            current.append(entry)
    if not origins and not current:
        return None
    return {'origins': origins, 'current': current}


def build_graph(item_id, items, links, reverse, all_reverse=None,
                idf=None, freq_pct=None):
    """Build a knowledge graph centred on *item_id*.

    Parameters
    ----------
    idf : dict | None
        Resource-ID → IDF score (from ``compute_resource_stats``).
        Used to rank shared items by *distinctiveness* so the most
        informative connections surface first.
    freq_pct : dict | None
        Resource-ID → frequency percentage (0–100).
        Embedded in the JSON so the client-side sliders can filter out
        connections through resources shared by too many items.
    """
    if item_id not in items:
        return None

    item = items[item_id]
    center_cat = item['class_label']

    nodes, edges = [], []
    categories = [{'name': center_cat}]
    cat_map = {center_cat: 0}
    seen = set()
    center_linked = {}  # vrid → node-id for shareable direct resources

    def ensure_cat(name):
        if name not in cat_map:
            cat_map[name] = len(categories)
            categories.append({'name': name})
        return cat_map[name]

    nodes.append({'id': f'item_{item_id}', 'name': item['title'], 'category': 0,
                  'symbolSize': 45, 'isCenter': True, 'itemId': item_id})

    # ── Direct relationships ────────────────────────────────────────
    # Collect and prioritise by category so the most important types
    # (Person, Contributor) appear first when capping at MAX_DIRECT_NODES.
    direct_rels = []  # (priority, term, label, vrid, cat)
    for term, label, vrid in links.get(item_id, []):
        cat = get_category(term)
        if not cat:
            continue
        pri = CAT_PRIORITY.index(cat) if cat in CAT_PRIORITY else len(CAT_PRIORITY)
        direct_rels.append((pri, term, label, vrid, cat))

    direct_rels.sort(key=lambda x: x[0])

    direct_count = 0
    for pri, term, label, vrid, cat in direct_rels:
        nid = f'resource_{vrid}'
        if nid not in seen:
            if direct_count >= MAX_DIRECT_NODES:
                continue
            seen.add(nid)
            node = {
                'id': nid,
                'name': items.get(vrid, {}).get('title', f'Resource {vrid}'),
                'category': ensure_cat(cat), 'symbolSize': 22, 'itemId': vrid,
            }
            # Annotate resource nodes with their corpus-wide frequency so the
            # client can show tooltips like "shared by 12 % of items".
            if freq_pct and vrid in freq_pct:
                node['freqPct'] = freq_pct[vrid]
            nodes.append(node)
            direct_count += 1
        edges.append({'source': f'item_{item_id}', 'target': nid, 'name': label})
        if term in SHAREABLE or term.startswith('marcrel:'):
            center_linked[vrid] = nid

    # ── Reverse lookups (items linking TO this one) ─────────────────
    is_section = item['class_term'] == 'frapo:ResearchGroup'
    reverse_count = 0
    for rid, rels in links.items():
        if rid == item_id or reverse_count >= MAX_REVERSE_NODES:
            continue
        for term, label, vrid in rels:
            if term == 'dcterms:isPartOf' and vrid == item_id:
                rnid = f'item_{rid}'
                if rnid not in seen:
                    seen.add(rnid)
                    nodes.append({'id': rnid, 'name': items.get(rid, {}).get('title', f'Item {rid}'),
                                  'category': ensure_cat('Project' if is_section else 'Linked Item'),
                                  'symbolSize': 22, 'itemId': rid})
                    reverse_count += 1
                edges.append({'source': rnid, 'target': f'item_{item_id}', 'name': 'Is Part Of'})

    # ── Low-connectivity fallback ───────────────────────────────────
    # For items with very few direct relationships (subjects, languages,
    # locations, …), show items that reference this entity instead.
    if all_reverse and direct_count < 5:
        referencing_ids = all_reverse.get(item_id, set())
        ref_cat_idx = ensure_cat('Research Item')
        ref_count = 0
        for rid in referencing_ids:
            if ref_count >= MAX_REVERSE_ITEMS:
                break
            rnid = f'item_{rid}'
            if rnid in seen:
                continue
            seen.add(rnid)
            ref_title = items.get(rid, {}).get('title', f'Item {rid}')
            nodes.append({'id': rnid, 'name': ref_title, 'category': ref_cat_idx,
                          'symbolSize': 16, 'itemId': rid})
            edges.append({'source': rnid, 'target': f'item_{item_id}', 'name': 'references'})
            ref_count += 1

    # ── Shared items — IDF-ranked co-occurrence discovery ───────────
    #
    # Two items sharing a resource that 65 % of the corpus also shares
    # is not a meaningful connection.  We use IDF to surface the items
    # that share *rare* resources with the centre, making the resulting
    # graph far more informative.
    #
    # Phase 1 — Discover all candidate shared items and collect every
    #           shared resource between each candidate and the centre.
    # Phase 2 — Score each candidate by *connection strength*: the sum
    #           of IDF scores of all shared resources.
    # Phase 3 — Sort by strength (strongest first) and take the top N.
    #           This ensures the most distinctively related items always
    #           appear, regardless of the order they were discovered.

    shared_candidates = {}  # sid → list of edge dicts
    discovered = set()      # avoid re-scanning a sid we already processed

    for vrid in center_linked:
        for sid in reverse.get(vrid, set()):
            if sid == item_id or sid in discovered:
                continue
            discovered.add(sid)
            snid = f'item_{sid}'
            matched = []
            for st, sl, sv in links.get(sid, []):
                if sv in center_linked:
                    ek = f'{snid}>{center_linked[sv]}'
                    if not any(e.get('_key') == ek for e in matched):
                        edge_idf = idf.get(sv, 0) if idf else 0
                        edge_freq = freq_pct.get(sv, 0) if freq_pct else 0
                        matched.append({
                            '_key': ek,
                            'source': snid, 'target': center_linked[sv],
                            'name': sl, 'isShared': True,
                            'idf': round(edge_idf, 2),
                            'freqPct': round(edge_freq, 1),
                        })
            if matched:
                shared_candidates[sid] = matched

    # Phase 2 — Rank by connection strength (sum of IDF across all
    # shared resources).  High strength = many rare shared properties.
    def _strength(matched_edges):
        return sum(e.get('idf', 0) for e in matched_edges)

    sorted_shared = sorted(
        shared_candidates.items(),
        key=lambda x: _strength(x[1]),
        reverse=True,
    )

    # Phase 3 — Emit nodes and edges for the top candidates.
    si_cat = None
    max_strength = 0.0
    for sid, matched in sorted_shared[:MAX_SHARED_NODES]:
        snid = f'item_{sid}'
        strength = round(_strength(matched), 2)
        shared_count = len(matched)
        if strength > max_strength:
            max_strength = strength
        if snid not in seen:
            seen.add(snid)
            if si_cat is None:
                si_cat = ensure_cat('Shared Item')
            nodes.append({
                'id': snid,
                'name': items.get(sid, {}).get('title', f'Item {sid}'),
                'category': si_cat, 'symbolSize': 16, 'itemId': sid,
                # Client-side sliders use these to filter interactively.
                'strength': strength,
                'sharedCount': shared_count,
            })
        for m in matched:
            edges.append({
                'source': m['source'], 'target': m['target'],
                'name': m['name'], 'isShared': True,
                'idf': m['idf'], 'freqPct': m['freqPct'],
            })

    if len(nodes) <= 1:
        return None

    # Compute stats for the client-side slider ranges.
    max_freq = max((e.get('freqPct', 0) for e in edges if e.get('isShared')), default=0)
    graph = {
        'nodes': nodes, 'edges': edges, 'categories': categories,
        'stats': {
            'maxStrength': round(max_strength, 2),
            'maxFreqPct': round(max_freq, 1),
        },
    }
    return graph


def main():
    password = get_password()
    print(f'Loading data via docker compose exec...')
    items, links, reverse, all_reverse, geo = load_data(password)

    print('  Computing resource IDF scores...')
    idf, freq_pct = compute_resource_stats(links, len(items))
    print(f'    {len(idf)} resources scored')

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'Generating graphs to {OUTPUT_DIR}/')

    generated = skipped = map_count = 0
    for item_id in items:
        graph = build_graph(item_id, items, links, reverse, all_reverse,
                            idf=idf, freq_pct=freq_pct)
        if not graph:
            skipped += 1
            continue
        # Embed location map data when the item has spatial/provenance links.
        item_map = build_item_map(item_id, links, geo)
        if item_map:
            graph['itemMap'] = item_map
            map_count += 1
        with open(os.path.join(OUTPUT_DIR, f'{item_id}.json'), 'w', encoding='utf-8') as f:
            json.dump(graph, f, ensure_ascii=False, separators=(',', ':'))
        generated += 1
        if generated % 500 == 0:
            print(f'  {generated} graphs...')

    print(f'Done. {generated} generated ({map_count} with location maps), {skipped} skipped.')


if __name__ == '__main__':
    main()
