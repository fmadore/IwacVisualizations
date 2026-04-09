"""Entity-specific dashboard generators."""

import json
import os

from .config import (OUTPUT_DIR, TEMPLATE_PERSONS, TEMPLATE_PROJECTS,
                     TEMPLATE_RESEARCH_ITEMS, TEMPLATE_RESOURCE_TYPE,
                     TEMPLATE_LOCATION, TEMPLATE_AUTHORITY)
from .aggregators import (
    aggregate_items, save_json, find_items_linking_to, build_beeswarm,
    build_heatmap, build_chord, build_stacked_timeline, build_sankey,
    build_sunburst, build_roles, build_contributor_network,
    build_affiliation_network, build_collab_network,
    build_subject_trends, build_language_timeline, build_treemap,
    build_geo_flows,
)


def _add_standard_charts(dashboard, entity_id, entity_title, item_ids,
                         items, links, children_of, item_year, geo):
    """Build and attach the standard set of advanced charts to a dashboard."""
    heatmap = build_heatmap(item_ids, links, items)
    if heatmap:
        dashboard['heatmap'] = heatmap
    chord = build_chord(item_ids, links, items)
    if chord:
        dashboard['chord'] = chord
    stacked = build_stacked_timeline(item_ids, links, items, item_year)
    if stacked:
        dashboard['stackedTimeline'] = stacked
    sankey = build_sankey(item_ids, links, items)
    if sankey:
        dashboard['sankey'] = sankey
    sunburst = build_sunburst(item_ids, links, items)
    if sunburst:
        dashboard['sunburst'] = sunburst
    roles = build_roles(item_ids, links, items)
    if roles:
        dashboard['roles'] = roles
    contrib_net = build_contributor_network(entity_id, entity_title, item_ids,
                                            items, links, children_of)
    if contrib_net:
        dashboard['contributorNetwork'] = contrib_net
    subj_trends = build_subject_trends(item_ids, links, items, item_year)
    if subj_trends:
        dashboard['subjectTrends'] = subj_trends
    lang_timeline = build_language_timeline(item_ids, links, items, item_year)
    if lang_timeline:
        dashboard['languageTimeline'] = lang_timeline
    treemap = build_treemap(item_ids, links, items, children_of, entity_title)
    if treemap:
        dashboard['treemap'] = treemap
    geo_flows = build_geo_flows(item_ids, links, items, geo)
    if geo_flows:
        dashboard['geoFlows'] = geo_flows


def generate_sections(items, links, reverse_links, children_of, item_year, temporal, geo):
    sections = [(iid, info) for iid, info in items.items()
                if info['class_term'] == 'frapo:ResearchGroup']
    print(f'\n=== Research Sections ({len(sections)}) ===')

    # Collect cross-section beeswarm data for a global file.
    all_beeswarm = []

    for sid, sinfo in sections:
        project_ids = children_of.get(sid, [])
        item_ids = []
        projects_breakdown = []
        gantt_data = []
        for pid in project_ids:
            proj_items = children_of.get(pid, [])
            item_ids.extend(proj_items)
            ptitle = items.get(pid, {}).get('title', f'Project {pid}')
            if proj_items:
                projects_breakdown.append({'name': ptitle, 'value': len(proj_items), 'itemId': pid})
            if pid in temporal:
                start, end = temporal[pid]
                gantt_data.append({'name': ptitle, 'start': start, 'end': end, 'itemId': pid})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        projects_breakdown.sort(key=lambda x: -x['value'])
        dashboard['projects'] = projects_breakdown
        if gantt_data:
            gantt_data.sort(key=lambda x: x['start'])
            dashboard['gantt'] = gantt_data
        # Beeswarm: per-section projects by start year.
        beeswarm = build_beeswarm(sinfo['title'], project_ids, items, children_of, temporal)
        if beeswarm:
            dashboard['beeswarm'] = beeswarm
            all_beeswarm.extend(beeswarm)
        _add_standard_charts(dashboard, sid, sinfo['title'], item_ids,
                             items, links, children_of, item_year, geo)
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[sid]['template_id'], 'section')
        save_json(sid, dashboard)
        print(f'  {sinfo["title"]}: {len(item_ids)} items')

    # Save cross-section beeswarm as a standalone file.
    if all_beeswarm:
        path = os.path.join(OUTPUT_DIR, 'beeswarm-all-sections.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(all_beeswarm, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  Cross-section beeswarm: {len(all_beeswarm)} points')


def generate_projects(items, links, reverse_links, children_of, item_year, geo):
    projects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == TEMPLATE_PROJECTS]
    print(f'\n=== Projects ({len(projects)}) ===')

    # Collect project index for Compare View selector.
    project_index = []

    count = 0
    for pid, pinfo in projects:
        item_ids = children_of.get(pid, [])
        if not item_ids:
            continue

        # Find section name(s) for this project.
        section_names = []
        for term, label, vrid in links.get(pid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('class_term') == 'frapo:ResearchGroup':
                section_names.append(items[vrid]['title'])

        project_index.append({
            'id': pid,
            'name': pinfo['title'],
            'items': len(item_ids),
            'sections': section_names,
        })

        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        _add_standard_charts(dashboard, pid, pinfo['title'], item_ids,
                             items, links, children_of, item_year, geo)
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[pid]['template_id'], 'project')
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')

    # Save project index for Compare View.
    project_index.sort(key=lambda p: p['name'])
    path = os.path.join(OUTPUT_DIR, 'projects-index.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(project_index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  Project index: {len(project_index)} projects')


def generate_people(items, links, reverse_links, children_of, item_year, geo):
    people = [(iid, info) for iid, info in items.items()
              if info['template_id'] == TEMPLATE_PERSONS]
    print(f'\n=== People ({len(people)}) ===')

    # All marcrel + dcterms:creator/contributor terms for reverse lookup.
    person_terms = {'dcterms:creator', 'dcterms:contributor', 'foaf:member'}
    # Also collect all marcrel:* terms from data.
    all_terms_in_data = set()
    for rev_terms in reverse_links.values():
        for t in rev_terms:
            if t.startswith('marcrel:'):
                all_terms_in_data.add(t)
    person_terms.update(all_terms_in_data)

    count = 0
    for pid, pinfo in people:
        item_ids = find_items_linking_to(pid, reverse_links, person_terms)
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)

        # Co-authors: other persons appearing in the same items.
        coauthors = {}
        for iid in item_ids:
            for term, label, vrid in links.get(iid, []):
                if (term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor')) and vrid != pid:
                    if vrid not in coauthors and items.get(vrid, {}).get('template_id') == TEMPLATE_PERSONS:
                        coauthors[vrid] = {'name': items[vrid]['title'], 'value': 0, 'itemId': vrid}
                    if vrid in coauthors:
                        coauthors[vrid]['value'] += 1
        dashboard['coAuthors'] = sorted(coauthors.values(), key=lambda x: -x['value'])[:20]
        # People: co-authors replaces contributors (redundant).
        dashboard.pop('contributors', None)
        # Contributor network: person -> project links.
        contrib_net = build_contributor_network(pid, pinfo['title'], item_ids,
                                                items, links, children_of)
        if contrib_net:
            dashboard['contributorNetwork'] = contrib_net
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[pid]['template_id'], 'person')
        save_json(pid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_institutions(items, links, reverse_links, children_of, item_year, geo):
    institutions = [(iid, info) for iid, info in items.items()
                    if info['class_term'] == 'foaf:Organization']
    print(f'\n=== Institutions ({len(institutions)}) ===')

    inst_set = {iid for iid, _ in institutions}

    inst_terms = {'frapo:isFundedBy', 'dcterms:provenance'}
    # Also marcrel properties (institutions can be publishers etc.)
    all_marcrel = {t for rev in reverse_links.values() for t in rev if t.startswith('marcrel:')}
    inst_terms.update(all_marcrel)

    count = 0
    for iid, iinfo in institutions:
        item_ids = find_items_linking_to(iid, reverse_links, inst_terms)
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)

        collab = build_collab_network(iid, iinfo['title'], item_ids, items,
                                      links, reverse_links, inst_set, inst_terms)
        if collab:
            dashboard['collabNetwork'] = collab

        affil = build_affiliation_network(iid, iinfo['title'], items, links, reverse_links)
        if affil:
            dashboard['affiliationNetwork'] = affil

        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[iid]['template_id'], 'organisation')
        save_json(iid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_locations(items, links, reverse_links, children_of, item_year, geo):
    locs = [(iid, info) for iid, info in items.items()
            if info['template_id'] == TEMPLATE_LOCATION]
    print(f'\n=== Locations ({len(locs)}) ===')

    count = 0
    for lid, linfo in locs:
        item_ids = find_items_linking_to(lid, reverse_links, {'dcterms:spatial', 'dcterms:provenance'})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        # Add self-location for minimap.
        if lid in geo:
            g = geo[lid]
            dashboard['selfLocation'] = {'name': g['name'], 'lat': g['lat'], 'lon': g['lon'], 'itemId': lid}
        dashboard['resourceType'] = TEMPLATE_RESOURCE_TYPE.get(items[lid]['template_id'], 'location')
        save_json(lid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_subjects(items, links, reverse_links, children_of, item_year, geo):
    subjects = [(iid, info) for iid, info in items.items()
                if info['template_id'] == TEMPLATE_AUTHORITY]
    print(f'\n=== Subjects/Authority ({len(subjects)}) ===')

    count = 0
    for sid, sinfo in subjects:
        item_ids = find_items_linking_to(sid, reverse_links, {'dcterms:subject'})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)

        # Co-occurring subjects: other subjects appearing in the same items.
        cosubs = {}
        for iid in item_ids:
            for term, label, vrid in links.get(iid, []):
                if term == 'dcterms:subject' and vrid != sid:
                    if vrid not in cosubs:
                        cosubs[vrid] = {'name': items.get(vrid, {}).get('title', ''), 'value': 0, 'itemId': vrid}
                    cosubs[vrid]['value'] += 1
        dashboard['coSubjects'] = sorted(cosubs.values(), key=lambda x: -x['value'])[:30]
        # Subjects: remove self-referential subjects chart.
        dashboard.pop('subjects', None)
        dashboard['resourceType'] = 'authority'
        save_json(sid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')


def generate_by_item_set(items, links, reverse_links, item_year, geo, item_sets,
                         set_id, term, label, resource_type='authority',
                         exclude_keys=None):
    """Generate dashboards for items in a specific item set, using reverse links."""
    set_items = item_sets.get(set_id, [])
    print(f'\n=== {label} (item set {set_id}, {len(set_items)} items) ===')

    count = 0
    for eid in set_items:
        item_ids = find_items_linking_to(eid, reverse_links, {term})
        if not item_ids:
            continue
        dashboard = aggregate_items(item_ids, items, links, item_year, geo)
        # Remove self-referential charts.
        if exclude_keys:
            for k in exclude_keys:
                dashboard.pop(k, None)
        dashboard['resourceType'] = resource_type
        save_json(eid, dashboard)
        count += 1
    print(f'  {count} dashboards generated')
