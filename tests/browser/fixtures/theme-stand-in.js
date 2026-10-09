/**
 * The IWAC theme's token cascade, built from tokens.json, for fixtures whose
 * specs flip the reader's light/dark toggle.
 *
 * Inline token values on <body> (on-this-day.html) paint one theme and cannot
 * be toggled. This declares the four selectors the theme's _colors.scss uses —
 * light on :root, dark on :root under a dark OS preference, and both again on
 * body[data-theme] for the manual switch — so setting body[data-theme] repaints
 * the page exactly as it does on the site, including the module's composed
 * tokens (iwac-core.css declares those on `:root, body`).
 *
 * Load it as the FIRST script inside <body>: it needs the body to stamp the
 * requested theme (`?theme=dark`) before anything paints.
 */
(function () {
    'use strict';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/tokens.json', false);
    xhr.send();
    var tokens = JSON.parse(xhr.responseText);

    function block(theme) {
        var all = Object.assign({}, tokens.values[theme], tokens[theme]);
        return Object.keys(all).map(function (name) {
            return name + ': ' + all[name] + ';';
        }).join(' ');
    }

    var style = document.createElement('style');
    style.id = 'fixture-theme-cascade';
    style.textContent = [
        ':root { ' + block('light') + ' }',
        '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ' + block('dark') + ' } }',
        'body[data-theme="dark"] { ' + block('dark') + ' }',
        'body[data-theme="light"] { ' + block('light') + ' }',
        'body { margin: 0; padding: 1rem; background: var(--background); color: var(--ink); font-family: var(--font-body); }',
    ].join('\n');
    document.head.appendChild(style);

    var theme = new URLSearchParams(location.search).get('theme');
    document.body.dataset.theme = theme === 'dark' ? 'dark' : 'light';
})();
