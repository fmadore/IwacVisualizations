'use strict';
/**
 * The guards' failure report: `✗ <guard>: <what>`, the offending lines
 * indented two spaces, then the advice — on stderr, then exit 1.
 *
 * Thirteen scripts printed that shape by hand. It is shared so the output a
 * maintainer scans in a CI log stays the same shape whichever guard failed,
 * and so a new guard does not have to re-derive it.
 */

/**
 * Print a failure without exiting (for a `main()` that returns its code).
 *
 * @param {string} title          after the cross: "block registry guard: 3 problem(s)"
 * @param {string[]} [lines]      each printed as "  <line>"
 * @param {string} [footer]       printed as-is when given (include its own \n)
 * @param {object} [opts]
 * @param {boolean} [opts.leadingBlank=true]  a blank line before the title
 */
function printFailure(title, lines = [], footer, opts = {}) {
    const lead = opts.leadingBlank === false ? '' : '\n';
    console.error(`${lead}✗ ${title}\n`);
    for (const line of lines) console.error(`  ${line}`);
    if (footer !== undefined) console.error(footer);
}

/** printFailure, then exit 1. */
function fail(title, lines, footer, opts) {
    printFailure(title, lines, footer, opts);
    process.exit(1);
}

/**
 * A file:line reference for a source offset — what a guard's message names
 * so the reader can jump to it.
 */
function lineOf(source, index) {
    return source.slice(0, Math.max(0, index)).split('\n').length;
}

module.exports = { printFailure, fail, lineOf };
