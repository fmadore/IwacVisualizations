'use strict';

// Run the whole suite as a visitor west of Greenwich, so a date formatted in
// the local zone instead of UTC shows up as the previous day (Node reads TZ
// when it changes, on Windows too). panels.test.js asserts it took effect.
process.env.TZ = 'America/New_York';

// Cross-platform entry point: Windows shells do not expand `*.test.js`, and
// Node treats a directory argument as a module rather than discovering it.
// Every `*.test.js` beside this file is loaded, in name order: the list used
// to be written out by hand, and a new test file that nobody added to it
// never ran (V-17).
const { readdirSync } = require('node:fs');
const { join } = require('node:path');

for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f !== 'index.test.js').sort()) {
    require(join(__dirname, file));
}
