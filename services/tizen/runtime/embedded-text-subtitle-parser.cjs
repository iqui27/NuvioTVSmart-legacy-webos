/* global module, require */
"use strict";

// The Tizen package replaces this source alias with the platform-neutral
// parser during staging. Keeping the alias runnable here makes the service
// directly testable without duplicating the parser implementation.
module.exports = require("../../webos/src/bitmapSubtitles.js");
