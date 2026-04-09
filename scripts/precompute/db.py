"""MySQL helpers and data loading."""

import os
import re
import subprocess
import sys

from .config import OMEKA_DIR, DB_USER, DB_PASS, DB_NAME


def get_password():
    if DB_PASS:
        return DB_PASS
    env_file = os.path.join(OMEKA_DIR, '.env')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                if line.startswith('MYSQL_PASSWORD='):
                    return line.strip().split('=', 1)[1]
    print('ERROR: Set DB_PASS or ensure MYSQL_PASSWORD is in .env')
    sys.exit(1)


def query_mysql(sql, password):
    cmd = [
        'docker', 'compose', 'exec', '-T', 'db',
        'mysql', f'-u{DB_USER}', f'-p{password}', DB_NAME,
        '--default-character-set=utf8mb4',
        '--batch', '--skip-column-names', '-e', sql,
    ]
    result = subprocess.run(cmd, capture_output=True, cwd=OMEKA_DIR)
    if result.returncode != 0:
        print(f'  MySQL error: {result.stderr.decode("utf-8", errors="replace").strip()}')
        return []
    stdout = result.stdout.decode('utf-8', errors='replace')
    return [tuple(line.split('\t')) for line in stdout.strip().split('\n') if line]


def load_all_data(password):
    """Load all data from MySQL into memory dictionaries."""
    print('Loading items...')
    items = {}
    for row in query_mysql("""
        SELECT r.id, r.title, r.resource_template_id,
               CONCAT(v.prefix, ':', rc.local_name) as class_term,
               rc.label as class_label
        FROM resource r
        LEFT JOIN resource_class rc ON r.resource_class_id = rc.id
        LEFT JOIN vocabulary v ON rc.vocabulary_id = v.id
        WHERE r.resource_type = 'Omeka\\\\Entity\\\\Item'
    """, password):
        items[int(row[0])] = {
            'title': row[1] or f'Item {row[0]}',
            'template_id': int(row[2]) if row[2] and row[2] != 'NULL' else None,
            'class_term': row[3] if row[3] and row[3] != 'NULL' and ':' in row[3] else '',
            'class_label': row[4] if row[4] and row[4] != 'NULL' else '',
        }
    print(f'  {len(items)} items')

    print('Loading relationships...')
    links = {}
    reverse_links = {}
    children_of = {}
    for row in query_mysql("""
        SELECT v.resource_id, CONCAT(vo.prefix, ':', p.local_name), p.label, v.value_resource_id
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE v.value_resource_id IS NOT NULL
    """, password):
        rid, term, label, vrid = int(row[0]), row[1], row[2], int(row[3])
        links.setdefault(rid, []).append((term, label, vrid))
        if term == 'dcterms:isPartOf':
            children_of.setdefault(vrid, []).append(rid)
        reverse_links.setdefault(vrid, {}).setdefault(term, []).append(rid)
    print(f'  {sum(len(v) for v in links.values())} links')

    print('Loading dates...')
    item_year = {}
    for row in query_mysql("""
        SELECT v.resource_id, v.value
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) IN
            ('dcterms:issued', 'dcterms:created', 'dcterms:date', 'fabio:hasDateCollected')
        AND v.value IS NOT NULL AND v.value != ''
    """, password):
        rid = int(row[0])
        if rid not in item_year:
            m = re.search(r'(\d{4})', row[1] or '')
            if m:
                item_year[rid] = m.group(1)
    print(f'  {len(item_year)} items with dates')

    print('Loading temporal intervals (for Gantt)...')
    temporal = {}
    for row in query_mysql("""
        SELECT v.resource_id, v.value
        FROM value v
        JOIN property p ON v.property_id = p.id
        JOIN vocabulary vo ON p.vocabulary_id = vo.id
        WHERE CONCAT(vo.prefix, ':', p.local_name) = 'dcterms:temporal'
        AND v.value IS NOT NULL AND v.value LIKE '%%/%%'
    """, password):
        rid = int(row[0])
        parts = row[1].split('/')
        if len(parts) == 2:
            temporal[rid] = (parts[0].strip(), parts[1].strip())
    print(f'  {len(temporal)} items with temporal intervals')

    print('Loading geo coordinates...')
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
    print(f'  {len(geo)} locations with coordinates')

    print('Loading item set memberships...')
    item_sets = {}
    for row in query_mysql("""
        SELECT item_id, item_set_id FROM item_item_set
    """, password):
        iid, isid = int(row[0]), int(row[1])
        item_sets.setdefault(isid, []).append(iid)
    print(f'  {len(item_sets)} item sets')

    return items, links, reverse_links, children_of, item_year, temporal, geo, item_sets
