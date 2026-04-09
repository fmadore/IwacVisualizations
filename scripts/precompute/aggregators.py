"""Shared aggregation and chart-data builder functions."""

import json
import os
import re
from collections import Counter

from .config import OUTPUT_DIR, TEMPLATE_PERSONS, TEMPLATE_PROJECTS


def save_json(item_id, data):
    path = os.path.join(OUTPUT_DIR, f'{item_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def find_items_linking_to(entity_id, reverse_links, terms):
    """Find item IDs that link to entity_id via any of the given terms."""
    result = set()
    rev = reverse_links.get(entity_id, {})
    for term in terms:
        result.update(rev.get(term, []))
    return list(result)


def aggregate_items(item_ids, items, links, item_year, geo):
    """Aggregate dashboard data from a list of item IDs."""
    timeline = {}
    types = {}
    languages = {}
    subjects = {}
    contributors = {}
    locations = {}

    for iid in item_ids:
        year = item_year.get(iid)
        if year:
            timeline[year] = timeline.get(year, 0) + 1

        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue

            if term == 'dcterms:type':
                if vrid not in types:
                    types[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                types[vrid]['value'] += 1
            elif term == 'dcterms:language':
                if vrid not in languages:
                    languages[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                languages[vrid]['value'] += 1
            elif term == 'dcterms:subject':
                if vrid not in subjects:
                    subjects[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                subjects[vrid]['value'] += 1
            elif term in ('dcterms:creator', 'dcterms:contributor') or term.startswith('marcrel:'):
                if vrid not in contributors:
                    contributors[vrid] = {'name': title, 'value': 0, 'itemId': vrid}
                contributors[vrid]['value'] += 1
            elif term == 'dcterms:spatial':
                if vrid in geo:
                    if vrid not in locations:
                        g = geo[vrid]
                        locations[vrid] = {
                            'name': g['name'], 'lat': g['lat'], 'lon': g['lon'],
                            'itemId': g['itemId'], 'value': 0, 'items': [],
                        }
                    locations[vrid]['value'] += 1
                    it_title = items.get(iid, {}).get('title', f'Item {iid}')
                    locations[vrid]['items'].append({'id': iid, 'title': it_title})

    return {
        'timeline': dict(sorted(timeline.items())),
        'types': sorted(types.values(), key=lambda x: -x['value']),
        'languages': sorted(languages.values(), key=lambda x: -x['value']),
        'subjects': sorted(subjects.values(), key=lambda x: -x['value'])[:200],
        'contributors': sorted(contributors.values(), key=lambda x: -x['value'])[:30],
        'locations': sorted(locations.values(), key=lambda x: -x['value']),
        'totalItems': len(item_ids),
    }


def build_heatmap(item_ids, links, items):
    """Build resource type x language heatmap data."""
    cross = {}
    type_set = set()
    lang_set = set()

    for iid in item_ids:
        item_types = []
        item_langs = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term == 'dcterms:type':
                item_types.append(title)
                type_set.add(title)
            elif term == 'dcterms:language':
                item_langs.append(title)
                lang_set.add(title)

        for t in item_types:
            for l in item_langs:
                cross[(t, l)] = cross.get((t, l), 0) + 1

    if not cross:
        return None

    rows = sorted(type_set)
    cols = sorted(lang_set)
    row_idx = {r: i for i, r in enumerate(rows)}
    col_idx = {c: i for i, c in enumerate(cols)}
    values = [[col_idx[c], row_idx[r], v] for (r, c), v in cross.items()]

    return {'rows': rows, 'cols': cols, 'values': values}


def build_chord(item_ids, links, items, term_filter='dcterms:subject', max_nodes=20, min_cooccurrence=2):
    """Build a co-occurrence chord diagram for a given property."""
    item_values = {}
    value_titles = {}

    for iid in item_ids:
        vals = []
        for term, label, vrid in links.get(iid, []):
            if term == term_filter:
                title = items.get(vrid, {}).get('title', '')
                if title:
                    vals.append(vrid)
                    value_titles[vrid] = title
        if len(vals) >= 2:
            item_values[iid] = vals

    pair_counts = Counter()
    node_counts = Counter()
    for vals in item_values.values():
        for v in vals:
            node_counts[v] += 1
        for i in range(len(vals)):
            for j in range(i + 1, len(vals)):
                pair = tuple(sorted([vals[i], vals[j]]))
                pair_counts[pair] += 1

    top_nodes = [vrid for vrid, _ in node_counts.most_common(max_nodes)]
    top_set = set(top_nodes)

    chord_links = []
    for (a, b), count in pair_counts.items():
        if count >= min_cooccurrence and a in top_set and b in top_set:
            chord_links.append({
                'source': value_titles[a], 'target': value_titles[b], 'value': count,
            })

    if not chord_links:
        return None

    chord_nodes = [{'name': value_titles[v], 'value': node_counts[v], 'itemId': v}
                   for v in top_nodes if v in value_titles]
    return {'nodes': chord_nodes, 'links': chord_links}


def build_sankey(item_ids, links, items):
    """Build contributor → project → resource type Sankey flow."""
    flows = {}
    for iid in item_ids:
        item_contributors = []
        item_project = None
        item_types = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                item_contributors.append(title)
            elif term == 'dcterms:isPartOf':
                item_project = title
            elif term == 'dcterms:type':
                item_types.append(title)

        if not item_project or not item_contributors or not item_types:
            continue

        for c in item_contributors[:3]:
            for t in item_types:
                flows[(c, item_project, t)] = flows.get((c, item_project, t), 0) + 1

    if not flows:
        return None

    contrib_counts = {}
    for (c, p, t), v in flows.items():
        contrib_counts[c] = contrib_counts.get(c, 0) + v
    top_contribs = set(sorted(contrib_counts, key=lambda x: -contrib_counts[x])[:10])

    node_names = set()
    sankey_links = []
    for (c, p, t), v in flows.items():
        if c not in top_contribs:
            continue
        node_names.update([c, p, t])
        sankey_links.append({'source': c, 'target': p, 'value': v})
        sankey_links.append({'source': p, 'target': t, 'value': v})

    link_map = {}
    for l in sankey_links:
        key = (l['source'], l['target'])
        link_map[key] = link_map.get(key, 0) + l['value']

    nodes = [{'name': n} for n in node_names]
    deduped_links = [{'source': s, 'target': t, 'value': v} for (s, t), v in link_map.items()]
    return {'nodes': nodes, 'links': deduped_links} if deduped_links else None


def build_sunburst(item_ids, links, items):
    """Build type → language → subject sunburst hierarchy."""
    tree = {}
    for iid in item_ids:
        item_types = []
        item_langs = []
        item_subjects = []
        for term, label, vrid in links.get(iid, []):
            title = items.get(vrid, {}).get('title', '')
            if not title:
                continue
            if term == 'dcterms:type':
                item_types.append(title)
            elif term == 'dcterms:language':
                item_langs.append(title)
            elif term == 'dcterms:subject':
                item_subjects.append(title)

        for t in item_types:
            for l in item_langs:
                tree.setdefault(t, {}).setdefault(l, {})
                if item_subjects:
                    for s in item_subjects[:5]:
                        tree[t][l][s] = tree[t][l].get(s, 0) + 1
                else:
                    tree[t][l]['(no subject)'] = tree[t][l].get('(no subject)', 0) + 1

    if not tree:
        return None

    result = []
    for type_name, langs in tree.items():
        type_node = {'name': type_name, 'children': []}
        for lang_name, subjects in langs.items():
            lang_node = {'name': lang_name, 'children': []}
            top_subs = sorted(subjects.items(), key=lambda x: -x[1])[:8]
            for sub_name, count in top_subs:
                lang_node['children'].append({'name': sub_name, 'value': count})
            type_node['children'].append(lang_node)
        result.append(type_node)
    return result if result else None


def build_stacked_timeline(item_ids, links, items, item_year):
    """Build stacked timeline: items by year, stacked by resource type."""
    year_type = {}
    all_types = set()

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        item_types = []
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:type':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    item_types.append(title)
                    all_types.add(title)
        if not item_types:
            item_types = ['(no type)']
            all_types.add('(no type)')
        for t in item_types:
            year_type.setdefault(year, {})[t] = year_type.get(year, {}).get(t, 0) + 1

    if not year_type:
        return None

    years = sorted(year_type.keys())
    type_list = sorted(all_types)
    series = [{'name': t, 'data': [year_type.get(y, {}).get(t, 0) for y in years]}
              for t in type_list]
    return {'years': years, 'series': series}


def build_collab_network(inst_id, inst_title, item_ids, items, links,
                         reverse_links, inst_set, inst_terms, max_nodes=25):
    """Build institution collaboration network from shared research items."""
    collab_counts = Counter()
    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term in inst_terms and vrid != inst_id and vrid in inst_set:
                collab_counts[vrid] += 1

    if not collab_counts:
        return None

    top_collabs = collab_counts.most_common(max_nodes)
    top_ids = {cid for cid, _ in top_collabs}

    nodes = [{'name': inst_title, 'value': len(item_ids),
              'itemId': inst_id, 'isSelf': True}]
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        nodes.append({'name': ctitle, 'value': count, 'itemId': cid})

    net_links = []
    for cid, count in top_collabs:
        ctitle = items.get(cid, {}).get('title', f'Institution {cid}')
        net_links.append({'source': inst_title, 'target': ctitle, 'value': count})

    collab_items = {}
    for cid in top_ids:
        collab_items[cid] = set(find_items_linking_to(cid, reverse_links, inst_terms))
    collab_list = list(top_ids)
    for i in range(len(collab_list)):
        for j in range(i + 1, len(collab_list)):
            a, b = collab_list[i], collab_list[j]
            shared = len(collab_items[a] & collab_items[b])
            if shared >= 2:
                a_title = items.get(a, {}).get('title', '')
                b_title = items.get(b, {}).get('title', '')
                if a_title and b_title:
                    net_links.append({'source': a_title, 'target': b_title, 'value': shared})

    return {'nodes': nodes, 'links': net_links} if net_links else None


def build_contributor_network(entity_id, entity_title, item_ids, items, links,
                              children_of, max_nodes=30):
    """Build person → project force graph from research items."""
    person_project = Counter()
    person_counts = Counter()
    project_counts = Counter()

    for iid in item_ids:
        item_persons = []
        item_project = None
        for term, label, vrid in links.get(iid, []):
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                if items.get(vrid, {}).get('template_id') == TEMPLATE_PERSONS:
                    item_persons.append(vrid)
            elif term == 'dcterms:isPartOf':
                if items.get(vrid, {}).get('template_id') == TEMPLATE_PROJECTS:
                    item_project = vrid
        if item_project and item_persons:
            for pid in item_persons:
                person_project[(pid, item_project)] += 1
                person_counts[pid] += 1
            project_counts[item_project] += 1

    if not person_project:
        return None

    top_persons = {pid for pid, _ in person_counts.most_common(max_nodes)}
    top_projects = {pid for pid, _ in project_counts.most_common(15)}

    nodes = []
    node_names = set()
    for pid in top_persons:
        title = items.get(pid, {}).get('title', f'Person {pid}')
        nodes.append({'name': title, 'value': person_counts[pid],
                       'itemId': pid, 'category': 'person'})
        node_names.add(title)
    for pid in top_projects:
        title = items.get(pid, {}).get('title', f'Project {pid}')
        nodes.append({'name': title, 'value': project_counts[pid],
                       'itemId': pid, 'category': 'project'})
        node_names.add(title)

    net_links = []
    for (person_id, proj_id), count in person_project.items():
        if person_id in top_persons and proj_id in top_projects:
            p_title = items.get(person_id, {}).get('title', '')
            pr_title = items.get(proj_id, {}).get('title', '')
            if p_title in node_names and pr_title in node_names:
                net_links.append({'source': p_title, 'target': pr_title, 'value': count})

    return {'nodes': nodes, 'links': net_links,
            'categories': ['person', 'project']} if net_links else None


def build_affiliation_network(inst_id, inst_title, items, links, reverse_links,
                              max_nodes=30):
    """Build person → institution affiliation network centred on an institution."""
    affiliated = reverse_links.get(inst_id, {}).get('dcterms:isPartOf', [])
    affiliated_persons = [pid for pid in affiliated
                          if items.get(pid, {}).get('template_id') == TEMPLATE_PERSONS]
    if not affiliated_persons:
        return None

    inst_counts = Counter()
    person_affl = {}
    for pid in affiliated_persons:
        affls = []
        for term, label, vrid in links.get(pid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('class_term') == 'foaf:Organization':
                affls.append(vrid)
                inst_counts[vrid] += 1
        person_affl[pid] = affls

    top_insts = {iid for iid, _ in inst_counts.most_common(max_nodes)}
    top_insts.add(inst_id)

    nodes = [{'name': inst_title, 'value': len(affiliated_persons),
              'itemId': inst_id, 'category': 'institution', 'isSelf': True}]
    node_names = {inst_title}

    for iid in top_insts:
        if iid == inst_id:
            continue
        title = items.get(iid, {}).get('title', f'Institution {iid}')
        nodes.append({'name': title, 'value': inst_counts[iid],
                       'itemId': iid, 'category': 'institution'})
        node_names.add(title)

    for pid in affiliated_persons[:max_nodes]:
        title = items.get(pid, {}).get('title', f'Person {pid}')
        nodes.append({'name': title, 'value': len(person_affl.get(pid, [])),
                       'itemId': pid, 'category': 'person'})
        node_names.add(title)

    net_links = []
    for pid in affiliated_persons[:max_nodes]:
        p_title = items.get(pid, {}).get('title', '')
        for iid in person_affl.get(pid, []):
            if iid not in top_insts:
                continue
            i_title = items.get(iid, {}).get('title', '')
            if p_title in node_names and i_title in node_names:
                net_links.append({'source': p_title, 'target': i_title, 'value': 1})

    return {'nodes': nodes, 'links': net_links,
            'categories': ['person', 'institution']} if net_links else None


def build_roles(item_ids, links, items):
    """Build contributor role distribution."""
    role_counts = {}
    for iid in item_ids:
        for term, label, vrid in links.get(iid, []):
            if term.startswith('marcrel:') or term in ('dcterms:creator', 'dcterms:contributor'):
                role_counts[label] = role_counts.get(label, 0) + 1
    if not role_counts:
        return None
    return sorted([{'name': n, 'value': c} for n, c in role_counts.items()],
                  key=lambda x: -x['value'])


def build_subject_trends(item_ids, links, items, item_year, top_n=10):
    """Build subject × year matrix for temporal trend visualization."""
    subject_year = {}
    subject_totals = {}

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:subject':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    subject_year.setdefault(title, {})[year] = \
                        subject_year.get(title, {}).get(year, 0) + 1
                    subject_totals[title] = subject_totals.get(title, 0) + 1

    if not subject_year:
        return None

    top_subjects = sorted(subject_totals, key=lambda s: -subject_totals[s])[:top_n]
    all_years = sorted(set(y for s in top_subjects for y in subject_year.get(s, {})))
    if len(all_years) < 2:
        return None

    series = [{'name': s, 'data': [subject_year.get(s, {}).get(y, 0) for y in all_years]}
              for s in top_subjects]
    return {'years': all_years, 'series': series}


def build_language_timeline(item_ids, links, items, item_year):
    """Build language × year stacked area."""
    year_lang = {}
    all_langs = set()

    for iid in item_ids:
        year = item_year.get(iid)
        if not year:
            continue
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:language':
                title = items.get(vrid, {}).get('title', '')
                if title:
                    year_lang.setdefault(year, {})[title] = \
                        year_lang.get(year, {}).get(title, 0) + 1
                    all_langs.add(title)

    if not year_lang or len(year_lang) < 2:
        return None

    years = sorted(year_lang.keys())
    series = [{'name': lang, 'data': [year_lang.get(y, {}).get(lang, 0) for y in years]}
              for lang in sorted(all_langs)]
    return {'years': years, 'series': series}


def build_treemap(item_ids, links, items, children_of, parent_title):
    """Build Project → Type treemap hierarchy."""
    project_items = {}
    unassigned = []
    for iid in item_ids:
        assigned = False
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:isPartOf' and items.get(vrid, {}).get('template_id') == TEMPLATE_PROJECTS:
                project_items.setdefault(vrid, []).append(iid)
                assigned = True
                break
        if not assigned:
            unassigned.append(iid)

    if not project_items and not unassigned:
        return None

    def type_children(iids):
        types = {}
        for iid in iids:
            for term, label, vrid in links.get(iid, []):
                if term == 'dcterms:type':
                    title = items.get(vrid, {}).get('title', '')
                    if title:
                        types[title] = types.get(title, 0) + 1
        return [{'name': t, 'value': c} for t, c in sorted(types.items(), key=lambda x: -x[1])]

    result = []
    for pid, iids in sorted(project_items.items(), key=lambda x: -len(x[1])):
        ptitle = items.get(pid, {}).get('title', f'Project {pid}')
        children = type_children(iids)
        if children:
            result.append({'name': ptitle, 'value': len(iids), 'children': children})

    if unassigned:
        children = type_children(unassigned)
        if children:
            result.append({'name': '(unassigned)', 'value': len(unassigned), 'children': children})
    return result if result else None


def build_geo_flows(item_ids, links, items, geo):
    """Build geographic flow data: origin → current location arcs."""
    flows = {}
    for iid in item_ids:
        origins = []
        currents = []
        for term, label, vrid in links.get(iid, []):
            if term == 'dcterms:spatial' and vrid in geo:
                origins.append(vrid)
            elif term == 'dcterms:provenance' and vrid in geo:
                currents.append(vrid)
        for o in origins:
            for c in currents:
                if o != c:
                    flows[(o, c)] = flows.get((o, c), 0) + 1

    if not flows:
        return None

    node_ids = set()
    for (o, c) in flows:
        node_ids.add(o)
        node_ids.add(c)

    nodes = [{'name': geo[nid]['name'], 'lat': geo[nid]['lat'],
              'lon': geo[nid]['lon'], 'itemId': nid} for nid in node_ids]

    flow_links = []
    for (o, c), count in sorted(flows.items(), key=lambda x: -x[1]):
        og, cg = geo[o], geo[c]
        flow_links.append({
            'from': og['name'], 'fromLat': og['lat'], 'fromLon': og['lon'],
            'to': cg['name'], 'toLat': cg['lat'], 'toLon': cg['lon'],
            'value': count,
        })
    return {'nodes': nodes, 'links': flow_links} if flow_links else None


def build_beeswarm(section_title, project_ids, items, children_of, temporal):
    """Build beeswarm data: projects as scatter points by start year."""
    points = []
    for pid in project_ids:
        ptitle = items.get(pid, {}).get('title', f'Project {pid}')
        item_count = len(children_of.get(pid, []))
        if pid in temporal:
            m = re.search(r'(\d{4})', temporal[pid][0])
            if m:
                points.append({
                    'category': section_title,
                    'value': int(m.group(1)),
                    'label': ptitle,
                    'size': max(item_count, 1),
                    'itemId': pid,
                })
    return points if points else None
