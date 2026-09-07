/**
 * IWAC Visualizations — Index Overview translations
 *
 * Strings only this block renders. They used to sit in the shared
 * `iwac-i18n.js`, which every block page loads whole — so a block-only
 * string there was bytes every OTHER page paid for and never used (S24).
 *
 * `check-i18n.js` proves the split is correct rather than assuming it: it
 * walks every `t('literal')` in each bundle and fails when a key is not
 * reachable from the shared dictionary plus the dictionaries that bundle
 * carries. Load order matters — this file is FIRST in the block's bundle,
 * so the strings exist before any panel asks for one.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.addTranslations) return;

    ns.addTranslations('en', {
        'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
            'How often the collection’s Subject and Spatial Coverage tags are used over time. The counts measure cataloguing rather than wording: an item tagged “Terrorism” adds one mention to its year, however many times the word appears in the text.',
        'Top entities':              'Most frequent entities in Dublin Core Subject and Spatial Coverage',
        'desc_top_entities':   'Authority records that appear most often in item-level Dublin Core Subject (dcterms:subject) and Spatial Coverage (dcterms:spatial) fields. Click a bar to open the entity\u2019s page.',
        'desc_lifespan':       'Each point is one entity. The horizontal axis is the span in years between its first and last appearance, the vertical axis its total number of mentions, and the colour shows the entity type. Click a point to open the entity.',
        'desc_temporal_extent': 'First and last year each top entity appears in the corpus (up to 30 per type, ranked by frequency). Each bar spans from earliest to latest mention.',
        'desc_places_map':     'Two complementary layers on the same map. Authority pins: every place in the IWAC authority index that has geographic coordinates. Mention bubbles: how often each place is tagged in an item\u2019s Dublin Core Spatial Coverage field, joined back to the authority pin by name. Click a pin to open the place\u2019s page.',
        'top_n_keywords':            '{count} keywords',
        'select_up_to_n':            'Select up to {count} keywords',
        'top_n_over_time':           'Top {count} keywords over time',
        'desc_subjects_bump':        'Rank of the leading subjects in each decade. A line that climbs is a subject gaining ground on those below it. A line breaks where the subject drops out of the decade’s top eight; hover over a decade for ranks and counts.',
        'desc_geo_attention':        'How much attention the press gave each country over time, measured by how often articles were catalogued as being about it. Drag the year slider or press play. The colour scale is the same in every year, so a darker country always means heavier coverage, whatever year you are viewing.',
    });

    ns.addTranslations('fr', {
        'Places in the index': 'Lieux de l’index',
        'Entity Index Explorer':     'Explorateur d\u2019entit\u00e9s',
        'Keyword Explorer':          'Explorateur de mots-cl\u00e9s',
        'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
            '\u00c0 quelle fr\u00e9quence les mots-cl\u00e9s Sujet et Couverture spatiale de la collection sont employ\u00e9s au fil du temps. Ces comptes mesurent l\u2019indexation et non la formulation : une notice index\u00e9e \u00ab Terrorisme \u00bb ajoute une seule mention \u00e0 son ann\u00e9e, quel que soit le nombre d\u2019occurrences du mot dans le texte.',
        'Entities by type':          'Entit\u00e9s par type',
        'Top entities':              'Entit\u00e9s les plus fr\u00e9quentes dans les champs Sujet et Couverture spatiale (Dublin Core)',
        'Temporal extent':           '\u00c9tendue temporelle',
        'Index table':               'Table de l\u2019index',
        'desc_top_entities':   'Notices d\u2019autorit\u00e9 apparaissant le plus souvent dans les champs Dublin Core Sujet (dcterms:subject) et Couverture spatiale (dcterms:spatial) des notices de la collection. Cliquez sur une barre pour ouvrir la fiche de l\u2019entit\u00e9.',
        'desc_lifespan':       'Chaque point est une entit\u00e9. L\u2019axe horizontal donne l\u2019\u00e9tendue en ann\u00e9es entre sa premi\u00e8re et sa derni\u00e8re apparition, l\u2019axe vertical son nombre total de mentions, et la couleur son type. Cliquez sur un point pour ouvrir la fiche.',
        'desc_temporal_extent': 'Premi\u00e8re et derni\u00e8re ann\u00e9e d\u2019apparition de chaque entit\u00e9 dans le corpus (jusqu\u2019\u00e0 30 par type, class\u00e9es par fr\u00e9quence). Chaque barre va de la mention la plus ancienne \u00e0 la plus r\u00e9cente.',
        'desc_places_map':     'Deux couches compl\u00e9mentaires sur la m\u00eame carte. Points d\u2019autorit\u00e9 : chaque lieu de l\u2019index IWAC ayant des coordonn\u00e9es. Bulles de mentions : fr\u00e9quence avec laquelle chaque lieu est indiqu\u00e9 dans le champ Dublin Core Couverture spatiale des notices, joint \u00e0 son point d\u2019autorit\u00e9 par le nom. Cliquez sur un point pour ouvrir la fiche du lieu.',
        'Span (years)':              'Dur\u00e9e (ann\u00e9es)',
        'Both layers':               'Les deux couches',
        'Authority pins':            'Points d\u2019autorit\u00e9',
        'Layer':                     'Couche',
        'Field':                     'Champ',
        'Facet by':                  'Filtrer par',
        'Newspaper':                 'Journal',
        'All newspapers':            'Tous les journaux',
        'View mode':                 'Mode d\u2019affichage',
        'top_n_keywords':            '{count} mots-cl\u00e9s',
        'Number to show':            'Nombre \u00e0 afficher',
        'select_up_to_n':            'S\u00e9lectionnez jusqu\u2019\u00e0 {count} mots-cl\u00e9s',
        'Search keywords':           'Rechercher des mots-cl\u00e9s',
        'No keywords selected':      'Aucun mot-cl\u00e9 s\u00e9lectionn\u00e9',
        'Keywords over time':        'Mots-cl\u00e9s dans le temps',
        'All keywords':              'Tous les mots-cl\u00e9s',
        'Keyword':                   'Mot-cl\u00e9',
        'Add':                       'Ajouter',
        'Remove':                    'Retirer',
        'top_n_over_time':           'Top {count} mots-cl\u00e9s dans le temps',
        'Keyword comparison':        'Comparaison de mots-cl\u00e9s',
        'Filtered by country: {country}':     'Filtr\u00e9 par pays : {country}',
        'Filtered by newspaper: {newspaper}': 'Filtr\u00e9 par journal : {newspaper}',
        'All data (global)':         'Toutes les donn\u00e9es (global)',
        'Select keywords to compare': 'S\u00e9lectionnez des mots-cl\u00e9s \u00e0 comparer',
        'Rising and falling subjects': 'Sujets montants et descendants',
        'desc_subjects_bump':        'Rang des principaux sujets dans chaque d\u00e9cennie. Une ligne qui monte est un sujet qui gagne du terrain sur ceux qui le suivent. Une ligne s\u2019interrompt quand le sujet sort des huit premiers de la d\u00e9cennie ; survolez une d\u00e9cennie pour les rangs et les comptes.',
        'Geographic attention over time': 'Attention g\u00e9ographique au fil du temps',
        'desc_geo_attention':        'L\u2019attention accord\u00e9e par la presse \u00e0 chaque pays au fil du temps, mesur\u00e9e par la fr\u00e9quence \u00e0 laquelle les articles ont \u00e9t\u00e9 catalogu\u00e9s comme le concernant. Faites glisser le curseur des ann\u00e9es ou lancez la lecture. L\u2019\u00e9chelle de couleurs est identique chaque ann\u00e9e, si bien qu\u2019un pays plus sombre signifie toujours une couverture plus forte, quelle que soit l\u2019ann\u00e9e affich\u00e9e.',
    });
})();
