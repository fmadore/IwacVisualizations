"""Shared configuration: paths, template IDs, item set IDs."""

import os

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(MODULE_DIR, 'asset', 'data', 'item-dashboards')

OMEKA_DIR = os.environ.get('OMEKA_DOCKER_DIR',
                           os.path.join(os.path.dirname(MODULE_DIR), 'omeka-s-docker'))
DB_USER = os.environ.get('DB_USER', 'omeka')
DB_PASS = os.environ.get('DB_PASS', '')
DB_NAME = os.environ.get('DB_NAME', 'omeka')

# Resource template IDs (from Omeka S config).
TEMPLATE_ORGANISATION = 2
TEMPLATE_LOCATION = 3
TEMPLATE_PERSONS = 4
TEMPLATE_PROJECTS = 5
TEMPLATE_AUTHORITY = 6
TEMPLATE_SECTIONS = 7
TEMPLATE_RESEARCH_ITEMS = 10

# Template ID → dashboard resourceType string.
TEMPLATE_RESOURCE_TYPE = {
    TEMPLATE_ORGANISATION: 'organisation',
    TEMPLATE_LOCATION: 'location',
    TEMPLATE_PERSONS: 'person',
    TEMPLATE_PROJECTS: 'project',
    TEMPLATE_SECTIONS: 'section',
    TEMPLATE_RESEARCH_ITEMS: 'researchItem',
}

# Item set IDs (from Omeka S config).
ITEM_SET_GENRE = 21
ITEM_SET_LANGUAGE = 19
ITEM_SET_RESOURCE_TYPE = 1
ITEM_SET_TARGET_AUDIENCE = 3169
ITEM_SET_PERSON = 18
ITEM_SET_INSTITUTION = 110
ITEM_SET_SUBJECT = 1852
ITEM_SET_PROJECT = 20

# Parent item IDs for category overviews.
OVERVIEW_GENRE = 22198
OVERVIEW_LANGUAGE = 2039
OVERVIEW_RESOURCE_TYPE = 22203
OVERVIEW_TARGET_AUDIENCE = 22479
OVERVIEW_PERSON = 22200
OVERVIEW_INSTITUTION = 22202
OVERVIEW_GROUP = 22536
OVERVIEW_LCSH = 3167
OVERVIEW_TAG = 22199
OVERVIEW_PROJECT = 3346
