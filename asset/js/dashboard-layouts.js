/**
 * Per-resource-type dashboard layout configurations.
 *
 * Each layout defines:
 *   order — chart keys in render order
 *   wide  — keys that span the full grid width
 *   tall  — keys that use the taller container (420px)
 *
 * Half-width charts are paired left-to-right; place them consecutively
 * so the 2-column CSS grid fills both columns without gaps.
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    ns.LAYOUTS = {
        organisation: {
            order: ['timeline', 'types', 'languages', 'roles', 'contributors',
                    'subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            wide:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations'],
            tall:  ['subjects', 'collabNetwork', 'affiliationNetwork', 'locations']
        },
        person: {
            order: ['timeline', 'types', 'languages', 'coAuthors',
                    'subjects', 'contributorNetwork', 'locations'],
            wide:  ['subjects', 'contributorNetwork', 'locations'],
            tall:  ['subjects', 'contributorNetwork', 'locations']
        },
        section: {
            order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'gantt', 'beeswarm', 'types', 'languages',
                    'roles', 'heatmap', 'subjects', 'subjectTrends',
                    'sunburst', 'treemap', 'locations', 'chord',
                    'contributorNetwork', 'contributors', 'projects', 'sankey'],
            wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline',
                    'gantt', 'beeswarm', 'heatmap', 'sankey', 'sunburst',
                    'treemap', 'subjects', 'subjectTrends', 'locations',
                    'chord', 'contributorNetwork', 'projects'],
            tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                    'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'chord', 'contributorNetwork']
        },
        project: {
            order: ['stackedTimeline', 'languageTimeline', 'timeline',
                    'types', 'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'sunburst', 'treemap', 'locations',
                    'chord', 'contributorNetwork', 'contributors',
                    'sankey'],
            wide:  ['stackedTimeline', 'languageTimeline', 'heatmap', 'sankey',
                    'sunburst', 'treemap', 'subjects', 'subjectTrends',
                    'locations', 'chord', 'contributorNetwork'],
            tall:  ['heatmap', 'sankey', 'sunburst', 'treemap', 'subjects',
                    'subjectTrends', 'locations', 'chord',
                    'contributorNetwork']
        },
        location: {
            order: ['selfLocation', 'timeline', 'types', 'languages',
                    'contributors', 'subjects', 'locations'],
            wide:  ['selfLocation', 'subjects', 'locations'],
            tall:  ['selfLocation', 'subjects', 'locations']
        },
        authority: {
            order: ['timeline', 'types', 'languages', 'coSubjects',
                    'contributors', 'locations'],
            wide:  ['coSubjects', 'locations'],
            tall:  ['coSubjects', 'locations']
        },
        genre: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'locations'],
            tall:  ['subjects', 'locations']
        },
        genreOverview: {
            order: ['genres', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['genres', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['genres', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        languageOverview: {
            order: ['topLanguages', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'types', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topLanguages', 'stackedTimeline', 'languageTimeline',
                    'heatmap', 'subjects', 'subjectTrends', 'locations'],
            tall:  ['topLanguages', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        resourceTypeOverview: {
            order: ['topResourceTypes', 'stackedTimeline', 'timeline',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topResourceTypes', 'stackedTimeline', 'heatmap',
                    'subjects', 'subjectTrends', 'locations'],
            tall:  ['topResourceTypes', 'heatmap', 'subjects',
                    'subjectTrends', 'locations']
        },
        targetAudienceOverview: {
            order: ['topAudiences', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'subjects', 'locations', 'contributors'],
            wide:  ['topAudiences', 'stackedTimeline', 'subjects',
                    'locations'],
            tall:  ['topAudiences', 'subjects', 'locations']
        },
        personOverview: {
            order: ['topPersons', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topPersons', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topPersons', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        institutionOverview: {
            order: ['topInstitutions', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'subjects', 'subjectTrends',
                    'locations', 'contributors'],
            wide:  ['topInstitutions', 'stackedTimeline', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topInstitutions', 'subjects', 'subjectTrends',
                    'locations']
        },
        groupOverview: {
            order: ['topGroups', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'subjects', 'locations', 'contributors'],
            wide:  ['topGroups', 'stackedTimeline', 'subjects', 'locations'],
            tall:  ['topGroups', 'subjects', 'locations']
        },
        lcshOverview: {
            order: ['topSubjects', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'roles', 'heatmap', 'subjects',
                    'subjectTrends', 'locations', 'contributors'],
            wide:  ['topSubjects', 'stackedTimeline', 'heatmap', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topSubjects', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        tagOverview: {
            order: ['topTags', 'stackedTimeline', 'timeline', 'types',
                    'languages', 'subjects', 'subjectTrends', 'locations',
                    'contributors'],
            wide:  ['topTags', 'stackedTimeline', 'subjects',
                    'subjectTrends', 'locations'],
            tall:  ['topTags', 'subjects', 'subjectTrends', 'locations']
        },
        projectOverview: {
            order: ['topProjects', 'stackedTimeline', 'languageTimeline',
                    'timeline', 'types', 'languages', 'roles', 'heatmap',
                    'subjects', 'subjectTrends', 'locations', 'contributors'],
            wide:  ['topProjects', 'stackedTimeline', 'languageTimeline',
                    'heatmap', 'subjects', 'subjectTrends', 'locations'],
            tall:  ['topProjects', 'heatmap', 'subjects', 'subjectTrends',
                    'locations']
        },
        researchItem: {
            order: ['timeline', 'types', 'languages', 'subjects',
                    'contributors', 'locations'],
            wide:  ['subjects', 'contributors', 'locations'],
            tall:  ['subjects', 'locations']
        }
    };

    ns.DEFAULT_LAYOUT = {
        order: ['selfLocation', 'stackedTimeline', 'languageTimeline',
                'timeline', 'gantt', 'beeswarm', 'types', 'languages',
                'roles', 'genres', 'heatmap', 'subjects', 'subjectTrends', 'sunburst',
                'treemap', 'locations', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork', 'contributors',
                'coAuthors', 'coSubjects', 'projects', 'sankey'],
        wide:  ['selfLocation', 'stackedTimeline', 'languageTimeline', 'gantt',
                'beeswarm', 'heatmap', 'sankey', 'sunburst', 'treemap',
                'subjects', 'subjectTrends', 'locations', 'chord',
                'collabNetwork', 'contributorNetwork', 'affiliationNetwork',
                'projects', 'coSubjects'],
        tall:  ['selfLocation', 'gantt', 'beeswarm', 'heatmap', 'sankey',
                'sunburst', 'treemap', 'subjects', 'subjectTrends',
                'locations', 'chord', 'collabNetwork',
                'contributorNetwork', 'affiliationNetwork']
    };
})();
