'use strict';

// Writes THIRD-PARTY-LICENSES.txt: the npm packages that webpack bundles into the application, followed by
// the libraries that are vendored as source files in this repository, and code that is embedded in other
// shipped files (tools/vendor-licenses.json).

const fs = require('fs');
const path = require('path');
const { splitLeading } = require('./vendor-loader');

function rule(title) {
  return '\n' + title + '\n' + '='.repeat(title.length) + '\n\n';
}

function renderLicenses(modules, vendored, root, embedded) {
  let out = 'Third-party software in this distribution of Banana\n'
    + 'Banana itself is licensed under the Apache License 2.0 (see LICENSE and NOTICE in this distribution).\n'
    + 'Licence texts that a library does not carry in its own file are in the licenses/ directory next to this file.\n';

  out += rule('Packages from npm that are bundled into the application');
  modules
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((m) => {
      const version = m.packageJson && m.packageJson.version ? ' ' + m.packageJson.version : '';
      out += m.name + version + ' (' + (m.licenseId || 'licence not identified') + ')\n';
      out += (m.licenseText ? m.licenseText.trim() : 'No licence file was found in the package; see the package itself.') + '\n\n';
    });

  out += rule('Libraries vendored in the Banana source tree');
  vendored
    .filter((l) => l.shipped !== false)
    .forEach((l) => {
      out += l.name + (l.version ? ' ' + l.version : '') + '\n';
      out += '  Licence:   ' + l.license + '\n';
      if (l.copyright) { out += '  Copyright: ' + l.copyright + '\n'; }
      if (l.licenseText) { out += '  Licence text: ' + [].concat(l.licenseText).join(', ') + '\n'; }
      out += '  Source:    ' + l.path + '\n';
      const header = splitLeading(fs.readFileSync(path.join(root, l.path), 'utf8'))
        .map((c) => c.text)
        .join('\n')
        .trim();
      if (header) {
        out += '  Notice in the file:\n' + header.split('\n').map((line) => '    ' + line).join('\n') + '\n';
      } else {
        out += '  The file has no header.\n';
      }
      out += '\n';
    });

  if (embedded && embedded.length) {
    out += rule('Code that is embedded in other files of this distribution');
    embedded.forEach((e) => {
      out += e.name + '\n';
      out += '  Licence:   ' + e.license + '\n';
      out += '  Copyright: ' + e.copyright + '\n';
      out += '  Found in:  ' + e.container + '\n';
      out += '  Licence text: ' + e.licenseText + '\n\n';
    });
  }
  return out;
}

module.exports = { renderLicenses };
