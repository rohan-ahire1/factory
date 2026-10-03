#!/usr/bin/env node
// Managed by the factory kit: `factory update` overwrites this file.
// Claude Code PreToolUse hook: stops agents from pushing to the protected branch (factory.json "branch")
// or merging PRs. Exit code 2 blocks the command and shows the message to the agent.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let branch = 'main';
try {
  branch = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'factory.json'), 'utf8')).branch || branch;
} catch {}

let input = '';
for await (const chunk of process.stdin) input += chunk;
let cmd = '';
try {
  cmd = JSON.parse(input || '{}').tool_input?.command ?? '';
} catch {}

const block = (why) => {
  process.stderr.write(`Blocked: ${why} Only the human merges into ${branch}. Push your own branch and open a PR instead.\n`);
  process.exit(2);
};

if (/\bgh\s+pr\s+merge\b/.test(cmd)) block('agents may not merge PRs.');

const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const targetsBranch = new RegExp(`(^|[\\s:+])(refs/heads/)?${escaped}(\\s|$)`);

for (const push of cmd.split(/&&|\|\||;|\n/).filter((part) => /\bgit\s+push\b/.test(part))) {
  const rest = push.replace(/^[\s\S]*?\bgit\s+push\b/, '');
  if (targetsBranch.test(rest)) block(`this push targets ${branch}.`);
  const explicitRef = rest.split(/\s+/).filter((a) => a && !a.startsWith('-')).length >= 2;
  if (!explicitRef) {
    let current = '';
    try {
      current = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {}
    if (current === branch) block(`you are on ${branch}, so a bare \`git push\` would push it.`);
  }
}
