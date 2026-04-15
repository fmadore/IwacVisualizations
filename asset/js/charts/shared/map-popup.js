/**
 * IWAC Visualizations — Shared MapLibre popup builder
 *
 * One-stop factory for the popup DOM node used by every map panel in
 * the module (collection-overview world map, index-overview places
 * map, person / entity dashboard locations map). Returns a DOM node
 * suitable for `maplibregl.Popup.setDOMContent(node)`, so event
 * listeners (e.g. pagination prev/next buttons) survive across
 * re-renders and we don't have to escape arbitrary user content
 * through innerHTML.
 *
 * Supported content slots:
 *   - title (plain text, optionally wrapped in an <a> if `titleHref`)
 *   - subtitleLines (array of plain-text secondary lines)
 *   - articles (array of { o_id, title, publisher, date } — when
 *     present, renders a paginated list at the bottom of the popup)
 *
 * Exposed as `P.buildMapPopup(config)`.
 *
 * Load order: after panels.js, before any panel module that uses
 * P.createIwacPopup with a rich body.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.map-popup: panels.js must load first');
        return;
    }

    var DEFAULT_PAGE_SIZE = 5;

    function formatDate(value) {
        if (!value) return '';
        var s = String(value).slice(0, 10);
        var d = new Date(s);
        if (isNaN(d.getTime())) return s;
        try {
            return d.toLocaleDateString(
                ns.locale === 'fr' ? 'fr-FR' : 'en-US',
                { year: 'numeric', month: 'short', day: 'numeric' }
            );
        } catch (e) {
            return s;
        }
    }

    /**
     * Build a popup DOM node.
     *
     * @param {Object} config
     * @param {string} config.title          Display name of the place / entity
     * @param {string} [config.titleHref]    Optional URL — wraps the title in an <a>
     * @param {Array<string>} [config.subtitleLines]
     *     Plain-text lines rendered under the title (e.g. ["France", "15 mentions"])
     * @param {Array<Object>} [config.articles]
     *     Each: { o_id, title, publisher, date }. When present and non-empty,
     *     renders a paginated article list at the bottom of the popup. When
     *     empty and `articles` is provided as `[]`, renders an empty-state line.
     *     Omit the key entirely to render a header-only popup.
     * @param {string} [config.siteBase]     Omeka site base path — required for
     *     article item links (`siteBase + '/item/' + o_id`)
     * @param {number} [config.pageSize=5]   Articles per page
     * @returns {HTMLElement}
     */
    P.buildMapPopup = function (config) {
        config = config || {};
        var root = P.el('div', 'iwac-vis-map-popup');

        // Header — title (optionally linked) + subtitle lines
        var header = P.el('div', 'iwac-vis-map-popup__header');
        var titleNode;
        if (config.titleHref) {
            titleNode = document.createElement('a');
            titleNode.className = 'iwac-vis-map-popup__title';
            titleNode.href = config.titleHref;
            titleNode.textContent = config.title || '';
        } else {
            titleNode = P.el('strong', 'iwac-vis-map-popup__title', config.title || '');
        }
        header.appendChild(titleNode);

        (config.subtitleLines || []).forEach(function (line) {
            if (line == null || line === '') return;
            header.appendChild(P.el('div', 'iwac-vis-map-popup__subtitle', String(line)));
        });
        root.appendChild(header);

        // Article list (optional)
        if (Array.isArray(config.articles)) {
            var articles = config.articles.slice();
            if (articles.length === 0) {
                root.appendChild(P.el('div', 'iwac-vis-map-popup__empty',
                    P.t('No data available')));
            } else {
                renderArticleList(root, articles, config);
            }
        }

        return root;
    };

    function renderArticleList(root, articles, config) {
        var pageSize = config.pageSize || DEFAULT_PAGE_SIZE;
        var siteBase = config.siteBase || '';
        var totalPages = Math.max(1, Math.ceil(articles.length / pageSize));
        var page = 0;

        var body = P.el('ul', 'iwac-vis-map-popup__list');
        root.appendChild(body);

        var footer = null;

        function renderPage() {
            body.innerHTML = '';
            var start = page * pageSize;
            var slice = articles.slice(start, start + pageSize);
            slice.forEach(function (a) {
                var li = P.el('li', 'iwac-vis-map-popup__item');

                var titleNode;
                if (a.o_id && siteBase) {
                    titleNode = document.createElement('a');
                    titleNode.className = 'iwac-vis-map-popup__item-title';
                    titleNode.href = siteBase + '/item/' + a.o_id;
                    titleNode.textContent = a.title || '';
                } else {
                    titleNode = P.el('span', 'iwac-vis-map-popup__item-title', a.title || '');
                }
                li.appendChild(titleNode);

                var metaBits = [];
                if (a.publisher) metaBits.push(a.publisher);
                if (a.date)      metaBits.push(formatDate(a.date));
                if (metaBits.length) {
                    li.appendChild(P.el('div', 'iwac-vis-map-popup__meta',
                        metaBits.join(' \u00b7 ')));
                }

                body.appendChild(li);
            });

            if (footer) {
                footer.label.textContent =
                    P.t('Page') + ' ' + (page + 1) + ' / ' + totalPages;
                footer.prev.disabled = page <= 0;
                footer.next.disabled = page >= totalPages - 1;
            }
        }

        if (totalPages > 1) {
            var footerRoot = P.el('div', 'iwac-vis-map-popup__pagination');
            var prev = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--prev', P.t('Previous'));
            prev.type = 'button';
            var label = P.el('span', 'iwac-vis-pagination__indicator');
            var next = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--next', P.t('Next'));
            next.type = 'button';
            footerRoot.appendChild(prev);
            footerRoot.appendChild(label);
            footerRoot.appendChild(next);
            root.appendChild(footerRoot);
            footer = { prev: prev, next: next, label: label };

            prev.addEventListener('click', function () {
                if (page > 0) { page--; renderPage(); }
            });
            next.addEventListener('click', function () {
                if (page < totalPages - 1) { page++; renderPage(); }
            });
        }

        renderPage();
    }
})();
