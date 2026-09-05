'use strict';

// Cross-platform entry point: Windows shells do not expand `*.test.js`, and
// Node treats a directory argument as a module rather than discovering it.
require('./i18n.test.js');
require('./gettext.test.js');
require('./panels.test.js');
require('./maplibre.test.js');
require('./maplibre-gate.test.js');
require('./assets.test.js');
require('./grammar.test.js');
require('./sentiment.test.js');
require('./diverging-bar.test.js');
require('./associated-entities.test.js');
require('./minimal-item.test.js');
require('./wordcloud-ink.test.js');
require('./gantt-window.test.js');
require('./lifecycle.test.js');
