#!/usr/bin/env node
// Managed by the factory kit: `factory update` overwrites this file. Configure the gates in factory.json.
// Runs every gate in factory.json, then (for apps) the browser check. Same command locally and in CI.
// Writes a summary to <out>/gates.md. Exit code 1 when any gate fails.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, ROOT } from './config.mjs';

const HELP = `gates: run the repo's checks (from factory.json) and the browser check

Usage: node .factory/gates.mjs [options]

  --setup            run the setup commands (install dependencies) first
  --setup-only       run only the setup commands
  --only a,b         run only these gates (names from factory.json, case-insensitive; "verify" = browser check)
  --skip a,b         skip these gates
  --shots /a,/b      routes to screenshot in the browser check (default /)
  --routes /a,/b     routes to check (default: factory.json app.routes)
  --out DIR          evidence folder (default .factory/evidence/<timestamp>)
  --list             print the gates and exit
  --help             show this help
`;

function parseArgs(argv) {
  const opts = { setup: false, setupOnly: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`${arg} needs a value.`);
      return v;
    };
    const names = () => next().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === '--setup') opts.setup = true;
    else if (arg === '--setup-only') opts.setupOnly = true;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--only') opts.only = names();
    else if (arg === '--skip') opts.skip = names();
    else if (arg === '--shots') opts.shots = next();
    else if (arg === '--routes') opts.routes = next();
    else if (arg === '--out') opts.out = next();
    else die(`Unknown option "${arg}". Run with --help for usage.`);
  }
  return opts;
}

function die(message) {
  process.stderr.write(`gates: ${message}\n`);
  process.exit(2);
}

const CI = !!process.env.GITHUB_ACTIONS;

function run(name, command) {
  process.stdout.write(CI ? `::group::${name}\n` : `\n▶ ${name}: ${command}\n`);
  const started = Date.now();
  const res = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit' });
  if (CI) process.stdout.write('::endgroup::\n');
  const ok = res.status === 0;
  const seconds = Math.round((Date.now() - started) / 1000);
  process.stdout.write(`${ok ? '✓' : '✗'} ${name} (${seconds}s)\n`);
  if (!ok && CI) process.stdout.write(`::error::${name} failed: ${command}\n`);
  return { name, command, ok, seconds };
}

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  die(err.message);
}
const opts = parseArgs(process.argv.slice(2));

const wanted = (name) => {
  const n = name.toLowerCase();
  return (!opts.only || opts.only.includes(n)) && !(opts.skip ?? []).includes(n);
};

const gates = cfg.gates.filter((g) => wanted(g.name));
const withVerify = !!cfg.app && wanted('verify');

if (opts.list) {
  for (const cmd of cfg.setup) process.stdout.write(`setup     ${cmd}\n`);
  for (const g of cfg.gates) process.stdout.write(`gate      ${g.name}: ${g.run}\n`);
  if (cfg.app) process.stdout.write(`gate      Verify: node .factory/verify.mjs --start (app.start: ${cfg.app.start})\n`);
  process.exit(0);
}

if (opts.setup || opts.setupOnly) {
  for (const cmd of cfg.setup) {
    if (!run(`Setup: ${cmd}`, cmd).ok) die('setup failed, so the gates were not run.');
  }
  if (opts.setupOnly) process.exit(0);
}

const out = opts.out ?? join('.factory', 'evidence', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(join(ROOT, out), { recursive: true });

const results = gates.map((g) => run(g.name, g.run));

if (withVerify) {
  if (results.every((r) => r.ok)) {
    const args = ['--start', '--out', out, '--shots', opts.shots ?? '/'];
    if (opts.routes) args.push('--routes', opts.routes);
    results.push(run('Verify', `node .factory/verify.mjs ${args.map((a) => `'${a}'`).join(' ')}`));
  } else {
    results.push({ name: 'Verify', command: 'node .factory/verify.mjs', ok: false, skipped: true, seconds: 0 });
    process.stdout.write('- Verify skipped: an earlier gate failed.\n');
  }
}

const ok = results.every((r) => r.ok);
const md = [
  `## Gates: ${ok ? 'all passed' : 'failed'}`,
  '',
  '| Gate | Result | Time |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.skipped ? 'skipped (earlier gate failed)' : r.ok ? 'pass' : '**fail**'} | ${r.seconds}s |`),
  '',
].join('\n');
writeFileSync(join(ROOT, out, 'gates.md'), md);

process.stdout.write(`\n${md}\nEvidence: ${out}\n`);
process.exit(ok ? 0 : 1);
