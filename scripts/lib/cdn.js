'use strict';
/**
 * What the two CDN scripts share: where the pins live, how a pin is read out
 * of the partial, and a fetch that gives up.
 *
 * `check-cdn-versions.js` (is a newer release out?) and `cdn-integrity.js`
 * (do the SRI hashes match the pins?) each carried their own copy of the
 * partial's path, the registry URL, a jsDelivr pin regex — two slightly
 * different ones — and an AbortController fetch-with-timeout. One parser now
 * reads every pin, and each script keeps the ones it is about.
 */

const { join } = require('path');
const { readText } = require('./fs');

const PARTIAL_REL = 'view/common/iwac-assets.phtml';
const PARTIAL = join(__dirname, '..', '..', PARTIAL_REL);
const REGISTRY = 'https://registry.npmjs.org';

/**
 * A jsDelivr npm pin: `cdn.jsdelivr.net/npm/<pkg>@<version>/<file>`, with a
 * scoped `@scope/pkg` name allowed (none is in use today). The scheme, the
 * file and the PHP string quotes around it are optional here; `quoted` says
 * whether the pin is a whole single-quoted `'https://…/<file>'` literal,
 * which is the form the integrity block is keyed by.
 */
const PIN_RE = /(')?(https:\/\/)?cdn\.jsdelivr\.net\/npm\/(@?[^@/\s'"]+(?:\/[^@/\s'"]+)?)@(\d[^/\s'"]*)\/([^'"\s]*)(')?/g;

/**
 * Every pin in `text`, in order of appearance (repeats included).
 *
 * @param {string} text
 * @returns {{url: string, pkg: string, version: string, file: string, quoted: boolean, line: number}[]}
 */
function parsePins(text) {
    const out = [];
    let m;
    PIN_RE.lastIndex = 0;
    while ((m = PIN_RE.exec(text)) !== null) {
        const [, open, scheme, pkg, version, file, close] = m;
        out.push({
            url: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file}`,
            pkg,
            version,
            file,
            quoted: Boolean(open && scheme && file && close),
            line: text.slice(0, m.index).split('\n').length,
        });
    }
    return out;
}

/** The partial's source, line endings folded to LF. */
function readPartialSource() {
    return readText(PARTIAL);
}

/**
 * `fetch(url)` that aborts after `timeoutMs`, with `read(response)` run inside
 * the same deadline (a body can stall as well as a connection).
 *
 * An explicit controller and a cleared timer rather than
 * `AbortSignal.timeout()`: that helper leaves its timer live for the full
 * timeout after the fetch resolves, and tearing it down under
 * `process.exit()` trips a libuv assertion on Windows (`UV_HANDLE_CLOSING`,
 * async.c:94) — a script returned 127 instead of its real exit code.
 *
 * @template T
 * @param {string} url
 * @param {{timeoutMs: number, headers?: object, read: (res: Response) => Promise<T>}} opts
 * @returns {Promise<T>}
 */
async function fetchWithTimeout(url, { timeoutMs, headers, read }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: headers || {} });
        return await read(res);
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error(`${url} timed out after ${timeoutMs} ms`, { cause: err });
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { PARTIAL, PARTIAL_REL, REGISTRY, PIN_RE, parsePins, readPartialSource, fetchWithTimeout };
