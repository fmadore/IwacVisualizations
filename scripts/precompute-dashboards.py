#!/usr/bin/env python3
"""
Pre-compute dashboard data for all entity types.

Uses `docker compose exec` to query MySQL — no port exposure needed.
Outputs JSON files to asset/data/item-dashboards/ (unified directory).

Usage:
  python3 scripts/precompute-dashboards.py

Set OMEKA_DOCKER_DIR if the omeka-s-docker directory is elsewhere:
  OMEKA_DOCKER_DIR=/path/to/omeka-s-docker python3 scripts/precompute-dashboards.py
"""

import json
import os
import sys

# Allow running from the repo root: python3 scripts/precompute-dashboards.py
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from precompute.config import OUTPUT_DIR, OMEKA_DIR, TEMPLATE_RESEARCH_ITEMS
from precompute.db import get_password, load_all_data
from precompute.aggregators import (
    aggregate_items, save_json,
    build_stacked_timeline, build_heatmap, build_roles,
    build_subject_trends, build_language_timeline, build_chord,
    build_sankey, build_sunburst, build_geo_flows,
)
from precompute.generators import (
    generate_sections, generate_projects, generate_people,
    generate_institutions, generate_locations, generate_subjects,
    generate_by_item_set,
)
from precompute.overviews import generate_category_overviews


def main():
    password = get_password()
    os.chdir(OMEKA_DIR)

    data = load_all_data(password)
    items, links, reverse_links, children_of, item_year, temporal, geo, item_sets = data

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    generate_sections(items, links, reverse_links, children_of, item_year, temporal, geo)
    generate_projects(items, links, reverse_links, children_of, item_year, geo)
    generate_people(items, links, reverse_links, children_of, item_year, geo)
    generate_institutions(items, links, reverse_links, children_of, item_year, geo)
    generate_locations(items, links, reverse_links, children_of, item_year, geo)
    generate_subjects(items, links, reverse_links, children_of, item_year, geo)
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=1, term='dcterms:type', label='Resource Types',
                         exclude_keys=['types'])
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=19, term='dcterms:language', label='Languages',
                         exclude_keys=['languages'])
    generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id=21, term='dcterms:format', label='Genres',
                         resource_type='genre')

    # Category overviews (Genre, Language, Person, etc.)
    generate_category_overviews(items, links, reverse_links, item_year, geo, item_sets)

    # Collection Overview (all research items)
    research_items = [iid for iid, info in items.items()
                      if info['template_id'] == TEMPLATE_RESEARCH_ITEMS]
    print(f'\n=== Collection Overview ({len(research_items)} research items) ===')
    if research_items:
        dashboard = aggregate_items(research_items, items, links, item_year, geo)
        stacked = build_stacked_timeline(research_items, links, items, item_year)
        if stacked:
            dashboard['stackedTimeline'] = stacked
        heatmap = build_heatmap(research_items, links, items)
        if heatmap:
            dashboard['heatmap'] = heatmap
        roles = build_roles(research_items, links, items)
        if roles:
            dashboard['roles'] = roles
        subj_trends = build_subject_trends(research_items, links, items, item_year)
        if subj_trends:
            dashboard['subjectTrends'] = subj_trends
        lang_timeline = build_language_timeline(research_items, links, items, item_year)
        if lang_timeline:
            dashboard['languageTimeline'] = lang_timeline
        chord = build_chord(research_items, links, items)
        if chord:
            dashboard['chord'] = chord
        sankey = build_sankey(research_items, links, items)
        if sankey:
            dashboard['sankey'] = sankey
        sunburst = build_sunburst(research_items, links, items)
        if sunburst:
            dashboard['sunburst'] = sunburst
        geo_flows = build_geo_flows(research_items, links, items, geo)
        if geo_flows:
            dashboard['geoFlows'] = geo_flows
        dashboard['resourceType'] = 'section'
        path = os.path.join(OUTPUT_DIR, 'collection-overview.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(dashboard, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  Overview dashboard saved ({dashboard["totalItems"]} items)')

    print(f'\nDone. Files in {OUTPUT_DIR}/')


if __name__ == '__main__':
    main()
