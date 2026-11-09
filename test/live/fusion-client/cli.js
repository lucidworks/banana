'use strict';

// Read-only commands over the registry directory.
//   node test/live/fusion-client/cli.js orphans --run <run-tag>
//   node test/live/fusion-client/cli.js orphans --all
// With neither option the command refuses. It lists ids that may exist on the
// instance and ids that were allocated but never sent. With the base URL and
// credentials in the environment it also reads every id that ever reached
// put-sent and reports those that still exist. It never deletes anything.

const settings = require('./settings');
const registry = require('./registry');
const { FusionClient } = require('./client');
const ids = require('./ids');

async function run(argv, env, out) {
  if (argv[0] !== 'orphans') {
    throw new Error('usage: cli.js orphans --run <run-tag> | --all');
  }
  const options = {};
  if (argv.indexOf('--all') !== -1) {
    options.all = true;
  }
  const at = argv.indexOf('--run');
  if (at !== -1) {
    options.run = argv[at + 1];
  }
  const dir = registry.checkRegistryDir(env[settings.VAR.registryDir]);
  let probe = null;
  if (env[settings.VAR.fusionUrl] && env[settings.VAR.user] && env[settings.VAR.credential]) {
    const client = new FusionClient({
      base: settings.originOf(env[settings.VAR.fusionUrl], settings.VAR.fusionUrl),
      user: env[settings.VAR.user],
      password: env[settings.VAR.credential],
      ledger: { stateOf: function () { return undefined; } },
      allocator: new ids.Allocator('000000000000')
    });
    await client.login();
    probe = function (id) { return client.probe(id); };
  }
  const report = await registry.orphans(dir, options, probe);
  out('may exist (' + report.mayExist.length + '):');
  report.mayExist.forEach(function (id) { out('  ' + id); });
  out('allocated, never sent (' + report.neverSent.length + '):');
  report.neverSent.forEach(function (id) { out('  ' + id); });
  if (probe) {
    out('found on the instance (' + report.found.length + '):');
    report.found.forEach(function (id) { out('  ' + id); });
  } else {
    out('not checked against the instance (no base URL or credentials in the environment)');
  }
  return report;
}

module.exports = { run: run };

if (require.main === module) {
  run(process.argv.slice(2), process.env, function (line) { process.stdout.write(line + '\n'); }).catch(function (e) {
    process.stderr.write(e.message + '\n');
    process.exit(2);
  });
}
