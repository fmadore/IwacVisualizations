'use strict';

// Cross-platform entry point: Windows shells do not expand `*.test.js`, and
// Node treats a directory argument as a module rather than discovering it.
require('./i18n.test.js');
require('./panels.test.js');
require('./assets.test.js');
require('./sentiment.test.js');
