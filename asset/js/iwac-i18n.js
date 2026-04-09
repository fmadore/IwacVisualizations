/**
 * IWAC Visualizations — JavaScript i18n
 *
 * Locale is resolved from <html lang="…">, which the IWAC theme populates via
 * Omeka's Internationalisation module. Language switching in IWAC is a page
 * navigation (full reload to a new locale URL), so there is no runtime switch —
 * translations just need to be read at render time.
 *
 * Usage:
 *   IWACVis.t('Loading dashboard')          // → "Loading dashboard" or "Chargement du tableau…"
 *   IWACVis.t('items', { count: 42 })       // interpolates {count}
 *
 * PHP-rendered strings (layout, blocks, etc.) use Omeka's $this->translate()
 * which reads from language/fr.mo — this file is only for strings rendered
 * client-side by the chart code.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    /* ----------------------------------------------------------------- */
    /*  Locale detection                                                  */
    /* ----------------------------------------------------------------- */

    /** Resolve the current locale from <html lang>, normalized to 2-letter code. */
    function detectLocale() {
        var raw = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
        // Accept "en", "en-us", "en_US", "fr-FR" → "en" | "fr"
        var short = raw.split(/[-_]/)[0];
        return short === 'fr' ? 'fr' : 'en';
    }

    ns.locale = detectLocale();

    /* ----------------------------------------------------------------- */
    /*  Translation dictionary                                            */
    /* ----------------------------------------------------------------- */

    /**
     * Keys are English source strings (matching Omeka convention).
     * Add new keys here as the UI grows. Keep `en` values identical to the
     * key — they exist so `t()` can fall back gracefully.
     *
     * For pluralization and interpolation, use curly placeholders:
     *   'items_count': '{count} items'
     * and call with: t('items_count', { count: 42 })
     */
    var DICTIONARY = {
        en: {
            // UI chrome
            'Loading dashboard': 'Loading dashboard',
            'Loading knowledge graph': 'Loading knowledge graph',
            'Loading collection overview': 'Loading collection overview',
            'Loading project comparison': 'Loading project comparison',
            'Dashboard': 'Dashboard',
            'Visualizations': 'Visualizations',
            'Knowledge Graph': 'Knowledge Graph',
            'Toggle fullscreen': 'Toggle fullscreen',
            'Save as image': 'Save as image',
            'Show patterns': 'Show patterns',
            'Hide patterns': 'Hide patterns',
            'No data available': 'No data available',
            'Failed to load': 'Failed to load',

            // Chart axis / tooltip
            'Count': 'Count',
            'Year': 'Year',
            'Total': 'Total',

            // Collection overview — summary labels
            'Articles': 'Articles',
            'Publications': 'Publications',
            'Documents': 'Documents',
            'Audiovisual': 'Audiovisual',
            'References': 'References',
            'Entities': 'Entities',
            'Countries': 'Countries',
            'Languages': 'Languages',
            'Words': 'Words',

            // Collection overview — chart titles
            'Items per year, by country': 'Items per year, by country',
            'Content by country': 'Content by country',
            'Languages represented': 'Languages represented',
            'Most-cited entities': 'Most-cited entities',
            'Across': 'Across',

            // Entity type tabs (must match INDEX_TYPES in the generator)
            'Persons': 'Persons',
            'Organizations': 'Organizations',
            'Places': 'Places',
            'Subjects': 'Subjects',
            'Events': 'Events',

            // References overview
            'Authors': 'Authors',
            'Publishers': 'Publishers',
            'Reference type': 'Reference type',
            'Reference types': 'Reference types',
            'References by type over time': 'References by type over time',
            'Top authors': 'Top authors',
            'Top subjects': 'Top subjects',
            'Languages studied': 'Languages',
            'Places studied': 'Places studied',
            'Fetching references…': 'Fetching references\u2026',

            // Reference type labels (values come from `o:resource_class` in French)
            'ref_type_Article de revue':    'Journal article',
            'ref_type_Chapitre':            'Book chapter',
            'ref_type_Livre':               'Book',
            'ref_type_Th\u00e8se':          'Thesis',
            'ref_type_M\u00e9moire':        'Master\u2019s thesis',
            'ref_type_Communication':       'Conference paper',
            'ref_type_Rapport':             'Report',
            'ref_type_Pr\u00e9sentation':   'Presentation',
            'ref_type_Compte rendu':        'Review',
            'ref_type_Article de journal':  'Newspaper article',
            'ref_type_Billet de blog':      'Blog post',
            'ref_type_Page web':            'Web page',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Unknown',

            // Plural-ish
            'items_count': '{count} items',
            'references_count': '{count} references',
            'mentions_count': '{count} mentions',
            'year_range': '{min} to {max}',
        },
        fr: {
            'Loading dashboard': 'Chargement du tableau de bord',
            'Loading knowledge graph': 'Chargement du graphe de connaissances',
            'Loading collection overview': 'Chargement de la vue d\u2019ensemble',
            'Loading project comparison': 'Chargement de la comparaison',
            'Dashboard': 'Tableau de bord',
            'Visualizations': 'Visualisations',
            'Knowledge Graph': 'Graphe de connaissances',
            'Toggle fullscreen': 'Basculer en plein \u00e9cran',
            'Save as image': 'Enregistrer comme image',
            'Show patterns': 'Afficher les motifs',
            'Hide patterns': 'Masquer les motifs',
            'No data available': 'Aucune donn\u00e9e disponible',
            'Failed to load': 'Le chargement a \u00e9chou\u00e9',

            'Count': 'Nombre',
            'Year': 'Ann\u00e9e',
            'Total': 'Total',

            // Collection overview — summary labels
            'Articles': 'Articles',
            'Publications': 'Publications',
            'Documents': 'Documents',
            'Audiovisual': 'Audiovisuel',
            'References': 'R\u00e9f\u00e9rences',
            'Entities': 'Entit\u00e9s',
            'Countries': 'Pays',
            'Languages': 'Langues',
            'Words': 'Mots',

            // Collection overview — chart titles
            'Items per year, by country': '\u00c9l\u00e9ments par ann\u00e9e, par pays',
            'Content by country': 'Contenu par pays',
            'Languages represented': 'Langues repr\u00e9sent\u00e9es',
            'Most-cited entities': 'Entit\u00e9s les plus cit\u00e9es',
            'Across': 'Sur',

            // Entity type tabs
            'Persons': 'Personnes',
            'Organizations': 'Organisations',
            'Places': 'Lieux',
            'Subjects': 'Sujets',
            'Events': '\u00c9v\u00e9nements',

            // References overview
            'Authors': 'Auteurs',
            'Publishers': 'Éditeurs',
            'Reference type': 'Type de r\u00e9f\u00e9rence',
            'Reference types': 'Types de r\u00e9f\u00e9rence',
            'References by type over time': 'R\u00e9f\u00e9rences par type dans le temps',
            'Top authors': 'Auteurs les plus cit\u00e9s',
            'Top subjects': 'Sujets r\u00e9currents',
            'Languages studied': 'Langues',
            'Places studied': 'Lieux \u00e9tudi\u00e9s',
            'Fetching references…': 'R\u00e9cup\u00e9ration des r\u00e9f\u00e9rences\u2026',

            // Reference type labels — already French from the dataset, pass-through
            'ref_type_Article de revue':    'Article de revue',
            'ref_type_Chapitre':            'Chapitre',
            'ref_type_Livre':               'Livre',
            'ref_type_Th\u00e8se':          'Th\u00e8se',
            'ref_type_M\u00e9moire':        'M\u00e9moire',
            'ref_type_Communication':       'Communication',
            'ref_type_Rapport':             'Rapport',
            'ref_type_Pr\u00e9sentation':   'Pr\u00e9sentation',
            'ref_type_Compte rendu':        'Compte rendu',
            'ref_type_Article de journal':  'Article de journal',
            'ref_type_Billet de blog':      'Billet de blog',
            'ref_type_Page web':            'Page web',
            'ref_type_Document':            'Document',
            'ref_type_Unknown':             'Inconnu',

            'items_count': '{count} \u00e9l\u00e9ments',
            'references_count': '{count} r\u00e9f\u00e9rences',
            'mentions_count': '{count} mentions',
            'year_range': '{min} \u00e0 {max}',
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Public API                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Translate a key. Falls back to the key itself (which is the English
     * source string) when no translation is registered.
     *
     * @param {string} key
     * @param {Object} [params] Values for {placeholder} interpolation
     * @returns {string}
     */
    ns.t = function (key, params) {
        var table = DICTIONARY[ns.locale] || DICTIONARY.en;
        var str = table[key] || (DICTIONARY.en[key] !== undefined ? DICTIONARY.en[key] : key);
        if (params) {
            str = str.replace(/\{(\w+)\}/g, function (_, name) {
                return params[name] != null ? params[name] : '{' + name + '}';
            });
        }
        return str;
    };

    /** Format an integer according to the current locale (thousands separators). */
    ns.formatNumber = function (n) {
        if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
            try { return new Intl.NumberFormat(ns.locale === 'fr' ? 'fr-FR' : 'en-US').format(n); }
            catch (e) { /* fall through */ }
        }
        return String(n);
    };

    /** Extend the dictionary at runtime (for strings added by individual charts). */
    ns.addTranslations = function (locale, entries) {
        if (!DICTIONARY[locale]) DICTIONARY[locale] = {};
        Object.keys(entries).forEach(function (k) {
            DICTIONARY[locale][k] = entries[k];
        });
    };
})();
