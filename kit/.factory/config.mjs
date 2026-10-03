#!/usr/bin/env node
// Managed by the factory kit: `factory update` overwrites this file. Configure the repo in factory.json.
// Loads factory.json, and answers small questions for the workflows:
//   node .factory/config.mjs get <key>      print one value (e.g. branch)
//   node .factory/config.mjs worker-args    print claude_args for the cloud worker

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  branch: 'main',
  node: '22',
  setup: [],
  gates: [],
  app: null,
  protect: ['.github/workflows/'],
  worker: { model: 'claude-opus-5-5', maxTurns: 150, tools: [] },
};

export function loadConfig() {
  const file = join(ROOT, 'factory.json');
  if (!existsSync(file)) throw new Error('factory.json is missing at the repo root. Run `factory init` to create it.');
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`factory.json is not valid JSON: ${err.message}`);
  }
  return { ...DEFAULTS, ...cfg, worker: { ...DEFAULTS.worker, ...cfg.worker } };
}

// First one or two words of each shell command, so the worker may run the repo's own commands.
function commandPrefixes(cmd) {
  return cmd
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim().replace(/^(\w+=\S*\s+)+/, ''))
    .filter(Boolean)
    .map((part) => {
      const words = part.split(/\s+/);
      return words.length > 1 && !words[1].startsWith('-') && !words[1].includes('$') ? `${words[0]} ${words[1]}` : words[0];
    });
}

export function workerArgs(cfg) {
  const branch = cfg.branch;
  const allowed = new Set([
    'Edit', 'Write', 'Read', 'Glob', 'Grep',
    'Bash(git:*)', 'Bash(node:*)', 'Bash(npx playwright:*)',
    'Bash(gh pr create:*)', 'Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(gh pr checks:*)',
    'Bash(gh issue view:*)', 'Bash(gh issue comment:*)',
    'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(mkdir:*)', 'Bash(rm -rf .factory/evidence:*)',
  ]);
  const commands = [...cfg.setup, ...cfg.gates.map((g) => g.run), ...(cfg.app?.start ? [cfg.app.start] : [])];
  for (const cmd of commands) for (const prefix of commandPrefixes(cmd)) allowed.add(`Bash(${prefix}:*)`);
  for (const tool of cfg.worker.tools) allowed.add(tool);

  const disallowed = [
    `Bash(git push origin ${branch}:*)`, `Bash(git push origin HEAD:${branch}:*)`,
    'Bash(git push -f:*)', 'Bash(git push --force:*)', 'Bash(gh pr merge:*)', 'Bash(gh api:*)',
  ];
  const quote = (list) => `"${[...list].join(',')}"`;
  return [
    `--model ${cfg.worker.model}`,
    `--max-turns ${cfg.worker.maxTurns}`,
    `--allowedTools ${quote(allowed)}`,
    `--disallowedTools ${quote(disallowed)}`,
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, key] = process.argv.slice(2);
  try {
    const cfg = loadConfig();
    if (cmd === 'get') {
      const value = cfg[key];
      process.stdout.write(typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''));
    } else if (cmd === 'worker-args') {
      process.stdout.write(workerArgs(cfg));
    } else {
      process.stderr.write('Usage: node .factory/config.mjs get <key> | worker-args\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`factory: ${err.message}\n`);
    process.exit(2);
  }
}
