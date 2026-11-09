'use strict';

// Reads the `panel_names` list out of the text of config.js (or config.solr.js).
function panelNamesFromConfig(text) {
  const m = /panel_names\s*:\s*\[([\s\S]*?)\]/.exec(text);
  if (!m) { throw new Error('config.js has no panel_names list'); }
  const names = [];
  m[1].replace(/(["'])([^"']+)\1/g, function (all, quote, name) { names.push(name); return all; });
  return names;
}

module.exports = { panelNamesFromConfig };
