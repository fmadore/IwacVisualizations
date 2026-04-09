"""Category overview dashboard generators."""

from .config import (
    ITEM_SET_GENRE, ITEM_SET_LANGUAGE, ITEM_SET_RESOURCE_TYPE,
    ITEM_SET_TARGET_AUDIENCE, ITEM_SET_PERSON, ITEM_SET_INSTITUTION,
    ITEM_SET_SUBJECT, ITEM_SET_PROJECT,
    OVERVIEW_GENRE, OVERVIEW_LANGUAGE, OVERVIEW_RESOURCE_TYPE,
    OVERVIEW_TARGET_AUDIENCE, OVERVIEW_PERSON, OVERVIEW_INSTITUTION,
    OVERVIEW_GROUP, OVERVIEW_LCSH, OVERVIEW_TAG, OVERVIEW_PROJECT,
)
from .aggregators import (
    aggregate_items, save_json, find_items_linking_to,
    build_stacked_timeline, build_heatmap, build_roles,
    build_subject_trends, build_language_timeline,
)


# -- Category overview generator ----------------------------------------------

def generate_overview(parent_id, label, set_items, terms, items, links,
                      reverse_links, item_year, geo, resource_type,
                      distribution_key, filter_fn=None):
    """Generate an overview dashboard for a parent/category item.

    Aggregates all research items linked to members of an item set, and
    builds a distribution bar chart keyed by `distribution_key`.

    Args:
        parent_id:        Omeka S item ID for the parent item (e.g. 22198 for Genre).
        label:            Human label for logging.
        set_items:        List of item IDs in the item set.
        terms:            Set of property terms used to link research items to set members.
        distribution_key: Key name for the bar chart data (e.g. 'genres', 'topLanguages').
        filter_fn:        Optional function(item_id, items) -> bool to filter set members.
    """
    members = [sid for sid in set_items if (not filter_fn or filter_fn(sid, items))]
    if not members:
        return
    print(f'\n=== {label} Overview (item {parent_id}) ===')

    all_items = set()
    member_counts = {}
    for mid in members:
        linked = find_items_linking_to(mid, reverse_links, terms)
        all_items.update(linked)
        if linked:
            mtitle = items.get(mid, {}).get('title', f'Item {mid}')
            member_counts[mtitle] = {'name': mtitle, 'value': len(linked), 'itemId': mid}

    all_items = list(all_items)
    if not all_items:
        print(f'  No linked items found')
        return

    dashboard = aggregate_items(all_items, items, links, item_year, geo)
    dashboard[distribution_key] = sorted(member_counts.values(), key=lambda x: -x['value'])

    stacked = build_stacked_timeline(all_items, links, items, item_year)
    if stacked:
        dashboard['stackedTimeline'] = stacked
    heatmap = build_heatmap(all_items, links, items)
    if heatmap:
        dashboard['heatmap'] = heatmap
    roles = build_roles(all_items, links, items)
    if roles:
        dashboard['roles'] = roles
    subj_trends = build_subject_trends(all_items, links, items, item_year)
    if subj_trends:
        dashboard['subjectTrends'] = subj_trends
    lang_timeline = build_language_timeline(all_items, links, items, item_year)
    if lang_timeline:
        dashboard['languageTimeline'] = lang_timeline

    dashboard['resourceType'] = resource_type
    save_json(parent_id, dashboard)
    print(f'  {len(all_items)} items, {len(member_counts)} {distribution_key}')


def generate_category_overviews(items, links, reverse_links, item_year, geo, item_sets):
    """Generate overview dashboards for all category parent items."""

    # Gather all marcrel + creator/contributor terms for person/institution lookups.
    person_terms = {'dcterms:creator', 'dcterms:contributor'}
    inst_terms = {'frapo:isFundedBy', 'dcterms:provenance'}
    for rev in reverse_links.values():
        for t in rev:
            if t.startswith('marcrel:'):
                person_terms.add(t)
                inst_terms.add(t)

    generate_overview(OVERVIEW_GENRE, 'Genre', item_sets.get(ITEM_SET_GENRE, []),
                      {'dcterms:format'}, items, links, reverse_links,
                      item_year, geo, 'genreOverview', 'genres')

    generate_overview(OVERVIEW_LANGUAGE, 'Language', item_sets.get(ITEM_SET_LANGUAGE, []),
                      {'dcterms:language'}, items, links, reverse_links,
                      item_year, geo, 'languageOverview', 'topLanguages')

    generate_overview(OVERVIEW_RESOURCE_TYPE, 'Resource Type', item_sets.get(ITEM_SET_RESOURCE_TYPE, []),
                      {'dcterms:type'}, items, links, reverse_links,
                      item_year, geo, 'resourceTypeOverview', 'topResourceTypes')

    generate_overview(OVERVIEW_TARGET_AUDIENCE, 'Target Audience', item_sets.get(ITEM_SET_TARGET_AUDIENCE, []),
                      {'dcterms:audience'}, items, links, reverse_links,
                      item_year, geo, 'targetAudienceOverview', 'topAudiences')

    generate_overview(OVERVIEW_PERSON, 'Person', item_sets.get(ITEM_SET_PERSON, []),
                      person_terms, items, links, reverse_links,
                      item_year, geo, 'personOverview', 'topPersons')

    # Filter to actual institutions (foaf:Organization), excluding groups.
    generate_overview(OVERVIEW_INSTITUTION, 'Institution', item_sets.get(ITEM_SET_INSTITUTION, []),
                      inst_terms, items, links, reverse_links,
                      item_year, geo, 'institutionOverview', 'topInstitutions',
                      filter_fn=lambda iid, it: it.get(iid, {}).get('class_term') == 'foaf:Organization')

    generate_overview(OVERVIEW_GROUP, 'Group', item_sets.get(ITEM_SET_INSTITUTION, []),
                      inst_terms, items, links, reverse_links,
                      item_year, geo, 'groupOverview', 'topGroups')

    def is_lcsh(sid, it):
        for term, label, vrid in links.get(sid, []):
            if term == 'dcterms:type' and vrid == OVERVIEW_LCSH:
                return True
        return False
    generate_overview(OVERVIEW_LCSH, 'LCSH Subject', item_sets.get(ITEM_SET_SUBJECT, []),
                      {'dcterms:subject'}, items, links, reverse_links,
                      item_year, geo, 'lcshOverview', 'topSubjects',
                      filter_fn=is_lcsh)

    def is_tag(sid, it):
        for term, label, vrid in links.get(sid, []):
            if term == 'dcterms:type' and vrid == OVERVIEW_LCSH:
                return False
        return True
    generate_overview(OVERVIEW_TAG, 'Tag', item_sets.get(ITEM_SET_SUBJECT, []),
                      {'dcterms:subject'}, items, links, reverse_links,
                      item_year, geo, 'tagOverview', 'topTags',
                      filter_fn=is_tag)

    generate_overview(OVERVIEW_PROJECT, 'Research Project', item_sets.get(ITEM_SET_PROJECT, []),
                      {'dcterms:isPartOf'}, items, links, reverse_links,
                      item_year, geo, 'projectOverview', 'topProjects')
