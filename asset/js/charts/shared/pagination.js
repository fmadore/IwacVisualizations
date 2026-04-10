/**
 * IWAC Visualizations — Shared pagination control
 *
 * A minimal, accessible "‹ Prev | Page N / M | Next ›" widget used by
 * the reusable table (table.js) and by any panel that needs client-side
 * paging (e.g. entities panel).
 *
 * Everything hangs off `window.IWACVis.panels` as `P.buildPagination`.
 *
 * Load order: after panels.js, before any block controller / panel
 * module that uses it.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.pagination: panels.js must load first');
        return;
    }

    /**
     * Build a pagination control.
     *
     * @param {Object} config
     * @param {number} config.currentPage  Zero-based current page index
     * @param {number} config.totalPages   Total page count (>= 1)
     * @param {function(number)} config.onChange  Called with new page index
     * @param {Object} [config.labels]
     * @param {string} [config.labels.prev] default: P.t('Previous')
     * @param {string} [config.labels.next] default: P.t('Next')
     * @param {string} [config.labels.page] default: P.t('Page')
     * @returns {{ root: HTMLElement, update: function({currentPage:number,totalPages:number}) }}
     */
    P.buildPagination = function (config) {
        var labels = config.labels || {};
        var prevLabel = labels.prev || P.t('Previous');
        var nextLabel = labels.next || P.t('Next');
        var pageLabel = labels.page || P.t('Page');

        var state = {
            currentPage: config.currentPage || 0,
            totalPages: Math.max(1, config.totalPages || 1)
        };

        var root = P.el('div', 'iwac-vis-pagination');

        var prevBtn = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--prev', prevLabel);
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', prevLabel);

        var indicator = P.el('span', 'iwac-vis-pagination__indicator');
        indicator.setAttribute('aria-live', 'polite');

        var nextBtn = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--next', nextLabel);
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', nextLabel);

        root.appendChild(prevBtn);
        root.appendChild(indicator);
        root.appendChild(nextBtn);

        function renderIndicator() {
            indicator.textContent = pageLabel + ' ' + (state.currentPage + 1) + ' / ' + state.totalPages;
            prevBtn.disabled = state.currentPage <= 0;
            nextBtn.disabled = state.currentPage >= state.totalPages - 1;
            root.style.display = state.totalPages <= 1 ? 'none' : '';
        }

        function go(delta) {
            var next = state.currentPage + delta;
            if (next < 0 || next >= state.totalPages) return;
            state.currentPage = next;
            renderIndicator();
            if (typeof config.onChange === 'function') {
                config.onChange(state.currentPage);
            }
        }

        prevBtn.addEventListener('click', function () { go(-1); });
        nextBtn.addEventListener('click', function () { go(1); });

        renderIndicator();

        return {
            root: root,
            update: function (next) {
                if (next && typeof next.currentPage === 'number') {
                    state.currentPage = next.currentPage;
                }
                if (next && typeof next.totalPages === 'number') {
                    state.totalPages = Math.max(1, next.totalPages);
                    if (state.currentPage >= state.totalPages) {
                        state.currentPage = state.totalPages - 1;
                    }
                }
                renderIndicator();
            }
        };
    };
})();
