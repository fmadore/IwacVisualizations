/**
 * IWAC Visualizations — Collection Overview translations
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
            'Newspaper coverage': 'Years represented for each newspaper',
            'Most-cited entities': 'Most frequently indexed entries',
            'collection.recent_desc': 'Records most recently added to IWAC. The date of addition may be much later than the document’s publication date.',
            'collection.map_desc': 'Switch between indexed places, sized by recorded frequency, and countries shaded by item count. A place mentioned in a source can differ from its country of publication. Only places with coordinates appear as points.',
            'collection.wordcloud_desc': 'Frequent words in the available text of French-language newspaper articles. Larger words occur more often; common grammatical words are removed. This view covers articles, not every document type in IWAC.',
            'collection.breakdown_desc': 'Nested rectangles group items by country, document type and source. Larger rectangles indicate more items. Select a rectangle to explore its contents and use the breadcrumb trail to return.',
            'collection.entities_desc': 'People, organisations, places, subjects and events ranked by their recorded frequency in the index. These are catalogue associations; a high rank does not directly measure historical influence.',
            'collection.language_desc': 'Items grouped by their recorded languages. A multilingual item can contribute to more than one language. These counts describe cataloguing and available holdings.',
            'collection.country_desc': 'Items grouped by the country recorded in their catalogue data. Compare document types within the collection; larger counts can reflect greater collecting coverage.',
            'collection.gantt_desc': 'Each bar spans the first and last dated items held for a newspaper or periodical. Gaps within that span may remain. The chart does not establish when a title began or ceased publication.',
            'collection.growth_desc': 'Bars show records added to IWAC each month; the line shows their cumulative total. These are catalogue addition dates, so a rise can reflect a batch import of older material.',
            'collection.types_desc': 'Collected items by publication year and document type. Use the country filter to explore changes within one country. Uneven collecting and missing dates can affect the pattern.',
            'collection.timeline_desc': 'Collected articles, periodical issues, archival documents, recordings and photographs by recorded publication year and country. Bibliographic references and index records are excluded. Counts describe IWAC holdings, not all material published in a country.',
        'source_locations_desc': 'Archives, repositories, web platforms and publication sources linked to collection items.',
        'source_map_summary': '{sources} sources · {mapped} mapped · {items} source-linked items',
    });

    ns.addTranslations('fr', {
            'collection.recent_desc': 'Notices les plus récemment ajoutées à IWAC. La date d’ajout peut être bien postérieure à la date de publication du document.',
            'collection.map_desc': 'Passez des lieux indexés, dont la taille indique la fréquence enregistrée, aux pays colorés selon le nombre de documents. Un lieu évoqué dans une source peut différer de son pays de publication. Seuls les lieux dotés de coordonnées apparaissent sous forme de points.',
            'collection.wordcloud_desc': 'Mots fréquents dans le texte disponible des articles de presse en français. Les mots les plus grands apparaissent plus souvent ; les mots grammaticaux courants sont retirés. Cette vue porte sur les articles, et non sur tous les types de documents IWAC.',
            'collection.breakdown_desc': 'Les rectangles imbriqués regroupent les documents par pays, type et source. Les grands rectangles indiquent davantage de documents. Sélectionnez un rectangle pour explorer son contenu et utilisez le fil d’Ariane pour revenir.',
            'collection.entities_desc': 'Personnes, organisations, lieux, sujets et événements classés selon leur fréquence enregistrée dans l’index. Il s’agit d’associations dans le catalogue ; un rang élevé ne mesure pas directement une influence historique.',
            'collection.language_desc': 'Documents regroupés selon leurs langues enregistrées. Un document multilingue peut contribuer à plusieurs langues. Ces nombres décrivent le catalogage et les documents disponibles.',
            'collection.country_desc': 'Documents regroupés selon le pays enregistré dans le catalogue. Comparez les types de documents au sein de la collection ; des nombres élevés peuvent refléter une collecte plus étendue.',
            'collection.gantt_desc': 'Chaque barre couvre la période entre les premiers et derniers documents datés conservés pour un journal ou périodique. Cette période peut comporter des lacunes. Le graphique n’établit pas les dates de début ou de fin de publication d’un titre.',
            'collection.growth_desc': 'Les barres indiquent les notices ajoutées à IWAC chaque mois ; la ligne indique leur total cumulé. Il s’agit des dates d’ajout au catalogue : une hausse peut correspondre à l’importation groupée de documents anciens.',
            'collection.types_desc': 'Documents collectés par année de publication et par type. Utilisez le filtre de pays pour explorer les variations au sein d’un pays. Une collecte inégale et des dates manquantes peuvent affecter le profil.',
            'collection.timeline_desc': 'Articles, numéros de périodiques, documents d’archives, enregistrements et photographies collectés, par année de publication et pays enregistrés. Les références bibliographiques et notices d’index sont exclues. Les nombres décrivent les collections IWAC, et non toute la production d’un pays.',
        'Where the collection was gathered': 'Où la collection a été constituée',
        'Where the sources are published': 'Où les sources sont publiées',
        'Items per year, by country': '\u00c9l\u00e9ments par ann\u00e9e, par pays',
        'Most-cited entities': 'Entrées les plus fréquemment indexées',
        'Newspaper coverage': 'Années représentées pour chaque journal',
        'Recent additions': 'Ajouts r\u00e9cents',
        'Collection growth over time': 'Croissance de la collection dans le temps',
        'Items by type, over time': '\u00c9l\u00e9ments par type, dans le temps',
        'French word cloud': 'Nuage de mots fran\u00e7ais',
        'World map': 'Carte du monde',
        'Source locations': 'Localisation des sources',
        'source_locations_desc': 'Archives, dépôts, plateformes web et sources de publication associés aux éléments de la collection.',
        'source_map_summary': '{sources} sources · {mapped} localisées · {items} éléments liés à une source',
        'No mapped sources': 'Aucune source localisée',
        'By type': 'Par type',
        'By year': 'Par ann\u00e9e',
        'Coordinates': 'Coordonnées',
        'Added': 'Ajout\u00e9',
        'No recent additions': 'Aucun ajout r\u00e9cent',
        'unique words': 'mots uniques',
    });
})();
