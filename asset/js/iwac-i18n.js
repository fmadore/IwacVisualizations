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

            // Plural-ish
            'items_count': '{count} items',
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

            'items_count': '{count} \u00e9l\u00e9ments',
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
