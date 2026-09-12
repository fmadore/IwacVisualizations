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
            'index.keywords_table_desc': 'Catalogue tags and their counts for the current filters. Select tags to compare their use over time.',
            'index.keywords_desc': 'Items carrying the selected subject or place tags, grouped by publication year. Each tag is counted once per item. Compare changes with the number and kinds of items available for each period.',
            'index.table_desc': 'Search the index entries and inspect their recorded frequency and dates. Open an entry to see its catalogue record.',
            'index.types_desc': 'Catalogue index entries grouped as people, organisations, places, subjects and events. Each count describes records in the index rather than mentions in source documents.',
            'Facet by': 'Group by',
            'Authority pins': 'Places in the index',
            'Entities by type': 'Index entries by type',
            'Entity Index Explorer': 'Explore the catalogue index',
            'Temporal extent': 'First and last recorded appearances',
        'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
            'How often the collection’s Subject and Spatial Coverage tags are used over time. The counts measure cataloguing rather than wording: an item tagged “Terrorism” adds one mention to its year, however many times the word appears in the text.',
        'Top entities':              'Most frequently indexed entries',
        'desc_top_entities':   'People, organisations, places, subjects and events most frequently recorded in the catalogue’s subject and place fields. These counts describe indexed associations, not repetitions of a name within a text. Click a bar to open the corresponding record.',
        'desc_lifespan':       'Each point is an index entry. The horizontal axis shows years between its first and last recorded appearances; the vertical axis shows its recorded frequency. Colours identify entry types. These spans describe the collection’s records, not a person’s lifespan or an organisation’s existence. Click a point to open the record.',
        'desc_temporal_extent': 'First and last year each top entity appears in the corpus (up to 30 per type, ranked by frequency). Each bar spans from earliest to latest mention.',
        'desc_places_map':     'Switch between all places with coordinates in the IWAC index and bubbles counting the items tagged with each place. These counts come from catalogue place fields. A place can be absent because it lacks a tag or coordinates. Click a point to open its record.',
        'top_n_keywords':            '{count} keywords',
        'select_up_to_n':            'Select up to {count} keywords',
        'top_n_over_time':           'Top {count} keywords over time',
        'desc_subjects_bump':        'Rank of the leading subjects in each decade. A line that climbs is a subject gaining ground on those below it. A line breaks where the subject drops out of the decade’s top eight; hover over a decade for ranks and counts.',
        'desc_geo_attention':        'How much attention the press gave each country over time, measured by how often articles were catalogued as being about it. Drag the year slider or press play. The colour scale is the same in every year, so a darker country always means heavier coverage, whatever year you are viewing.',
    });

    ns.addTranslations('fr', {
            'index.keywords_table_desc': 'Mots-clés du catalogue et leurs nombres pour les filtres actifs. Sélectionnez des mots-clés pour comparer leur usage au fil du temps.',
            'index.keywords_desc': 'Documents portant les mots-clés de sujets ou de lieux sélectionnés, regroupés par année de publication. Chaque mot-clé est compté une fois par document. Comparez les variations au nombre et aux types de documents disponibles pour chaque période.',
            'index.table_desc': 'Recherchez les entrées de l’index et examinez leur fréquence et leurs dates enregistrées. Ouvrez une entrée pour consulter sa notice.',
            'index.types_desc': 'Entrées de l’index regroupées en personnes, organisations, lieux, sujets et événements. Chaque nombre décrit des notices d’index plutôt que des mentions dans les documents sources.',
        'Places in the index': 'Lieux de l’index',
        'Entity Index Explorer': 'Explorer l’index du catalogue',
        'Keyword Explorer':          'Explorateur de mots-cl\u00e9s',
        'Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.':
            '\u00c0 quelle fr\u00e9quence les mots-cl\u00e9s Sujet et Couverture spatiale de la collection sont employ\u00e9s au fil du temps. Ces comptes mesurent l\u2019indexation et non la formulation : une notice index\u00e9e \u00ab Terrorisme \u00bb ajoute une seule mention \u00e0 son ann\u00e9e, quel que soit le nombre d\u2019occurrences du mot dans le texte.',
        'Entities by type': 'Entrées de l’index par type',
        'Top entities':              'Entrées les plus fréquemment indexées',
        'Temporal extent': 'Première et dernière apparitions enregistrées',
        'Index table':               'Table de l\u2019index',
        'desc_top_entities':   'Personnes, organisations, lieux, sujets et événements les plus fréquemment enregistrés dans les champs de sujets et de lieux du catalogue. Ces nombres décrivent les associations indexées, et non les répétitions d’un nom dans un texte. Cliquez sur une barre pour ouvrir la notice correspondante.',
        'desc_lifespan':       'Chaque point correspond à une entrée de l’index. L’axe horizontal indique le nombre d’années entre sa première et sa dernière apparitions enregistrées ; l’axe vertical, sa fréquence enregistrée. Les couleurs distinguent les types d’entrées. Ces durées décrivent les notices de la collection, sans mesurer la vie d’une personne ou l’existence d’une organisation. Cliquez sur un point pour ouvrir la notice.',
        'desc_temporal_extent': 'Premi\u00e8re et derni\u00e8re ann\u00e9e d\u2019apparition de chaque entit\u00e9 dans le corpus (jusqu\u2019\u00e0 30 par type, class\u00e9es par fr\u00e9quence). Chaque barre va de la mention la plus ancienne \u00e0 la plus r\u00e9cente.',
        'desc_places_map':     'Passez des lieux dotés de coordonnées dans l’index IWAC aux bulles comptant les documents associés à chaque lieu. Ces nombres proviennent des champs de lieux du catalogue. Un lieu peut manquer faute d’indexation ou de coordonnées. Cliquez sur un point pour ouvrir sa notice.',
        'Span (years)':              'Dur\u00e9e (ann\u00e9es)',
        'Both layers':               'Les deux couches',
        'Authority pins': 'Lieux de l’index',
        'Layer':                     'Couche',
        'Field':                     'Champ',
        'Facet by': 'Regrouper par',
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
