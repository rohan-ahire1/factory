#!/usr/bin/env node
// factory: install the agent factory into any git repo, keep it updated, and check it's wired up.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../lib/detect.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(KIT_ROOT, 'kit');
const SCAFFOLD = join(KIT_ROOT, 'scaffold');
const VERSION = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).version;
const KEYCHAIN_SERVICE = 'factory-claude-token';

const HELP = `factory ${VERSION}: an agent factory for any GitHub repo

Usage: factory <command> [repo path, default: current directory]

  init      add the factory to a repo: factory.json (detected), workflows, skills, guard, docs
  update    refresh the kit-managed files to this version; keeps factory.json and your docs
  doctor    check the setup and say exactly what is missing
  secret    copy your Claude token from the macOS Keychain into the repo's Actions secrets
            (factory secret --save stores the token in the Keychain first; it asks for it hidden)
  help      show this help

After init: review factory.json, run \`node .factory/gates.mjs\`, open a PR, then \`factory secret\`.
`;

const ok = (msg) => process.stdout.write(`  ✓ ${msg}\n`);
const warn = (msg) => process.stdout.write(`  ! ${msg}\n`);
const die = (msg) => {
  process.stderr.write(`factory: ${msg}\n`);
  process.exit(1);
};

function repoRoot(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    die(`${dir} is not inside a git repository. Run \`git init\` first.`);
  }
}

function gh(args, cwd) {
  const res = spawnSync('gh', args, { cwd, encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() };
}

function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full)];
  });
}

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// ---------- pieces that merge into files the repo already owns ----------

const BLOCK_START = '<!-- factory:start -->';
const BLOCK_END = '<!-- factory:end -->';

function agentsBlock(cfg) {
  const rows = [
    ...cfg.setup.map((c) => `| Install | \`${c}\` |`),
    ...cfg.gates.map((g) => `| ${g.name} | \`${g.run}\` |`),
    ...(cfg.app ? ['| Prove it in a browser | `node .factory/verify.mjs --start --shots <routes>` (after the build) |'] : []),
    '| **All gates** | `node .factory/gates.mjs` (add `--shots <routes>` for UI changes) |',
  ];
  const protect = cfg.protect.length ? cfg.protect.map((p) => `\`${p}\``).join(', ') : 'nothing';
  return `${BLOCK_START}
<!-- Managed by the factory kit from factory.json. Edit factory.json, then run \`factory update\`. -->

## Factory rules

### Commands

| What | Command |
|---|---|
${rows.join('\n')}

### Hard rules

1. **Never push to \`${cfg.branch}\`, merge PRs, or run a deploy.** Work on a branch, open a PR, and stop. A human merges.
2. Don't edit ${protect} unless the issue asks for it explicitly.
3. No secrets in code, logs, PRs or screenshots.

### Definition of done

A change is done only when all of these hold. Show the evidence, don't just say it:

- \`node .factory/gates.mjs\` passes.${cfg.app ? '\n- For UI changes: you ran it with `--shots <changed routes>` and looked at the mobile and desktop screenshots.' : ''}
- The diff is the smallest one that solves the problem. No drive-by refactors, no new dependencies without a stated reason.
- One concern per PR. If the work is bigger, split it and list the follow-ups.
- The PR body follows \`.github/pull_request_template.md\`.
- See \`docs/factory/README.md\` for how the factory works.
${BLOCK_END}`;
}

function upsertAgents(root, cfg, changes) {
  const file = join(root, 'AGENTS.md');
  const block = agentsBlock(cfg);
  const current = read(file);
  if (current === null) {
    const name = root.split('/').pop();
    write(file, `# ${name}: agent guide\n\n<!-- One paragraph: what this repo is and its stack. -->\n\n## Map\n\n<!-- Key folders and what lives in them. -->\n\n## Rules\n\n<!-- Project rules: product, brand, style, anything an agent must never do here. -->\n\n${block}\n`);
    changes.push('AGENTS.md (new; fill in the Map and Rules sections)');
  } else if (current.includes(BLOCK_START) && current.includes(BLOCK_END)) {
    const next = current.replace(new RegExp(`${BLOCK_START}[\\s\\S]*?${BLOCK_END}`), block);
    if (next !== current) {
      write(file, next);
      changes.push('AGENTS.md (factory section refreshed)');
    }
  } else {
    write(file, `${current.trimEnd()}\n\n${block}\n`);
    changes.push('AGENTS.md (factory section appended)');
  }

  const claude = join(root, 'CLAUDE.md');
  const claudeText = read(claude);
  if (claudeText === null) {
    write(claude, '@AGENTS.md\n');
    changes.push('CLAUDE.md (new; imports AGENTS.md)');
  } else if (!claudeText.includes('@AGENTS.md')) {
    write(claude, `${claudeText.trimEnd()}\n\n@AGENTS.md\n`);
    changes.push('CLAUDE.md (now imports AGENTS.md)');
  }
}

function mergeSettings(root, cfg, changes) {
  const file = join(root, '.claude', 'settings.json');
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      warn('.claude/settings.json is not valid JSON; left it alone. Add the guard hook by hand (see docs/factory/README.md).');
      return;
    }
  }
  const before = JSON.stringify(settings);
  settings.permissions ??= {};
  const add = (key, rules) => {
    const list = (settings.permissions[key] ??= []);
    for (const rule of rules) if (!list.includes(rule)) list.push(rule);
  };
  add('allow', ['Bash(node .factory/gates.mjs:*)', 'Bash(node .factory/verify.mjs:*)']);
  add('deny', ['Bash(gh pr merge:*)', `Bash(git push origin ${cfg.branch}:*)`, 'Bash(git push -f:*)', 'Bash(git push --force:*)']);

  const command = 'node "$CLAUDE_PROJECT_DIR/.factory/guard.mjs"';
  settings.hooks ??= {};
  const pre = (settings.hooks.PreToolUse ??= []);
  const wired = pre.some((m) => m.hooks?.some((h) => h.command?.includes('.factory/guard.mjs')));
  if (!wired) pre.push({ matcher: 'Bash', hooks: [{ type: 'command', command }] });

  if (JSON.stringify(settings) !== before) {
    write(file, JSON.stringify(settings, null, 2) + '\n');
    changes.push('.claude/settings.json (guard hook and permissions)');
  }
}

function ensureGitignore(root, changes) {
  const file = join(root, '.gitignore');
  const lines = (read(file) ?? '').split('\n');
  if (lines.some((l) => l.trim() === '.factory/evidence/')) return;
  // An older setup ignored all of .factory/, which would also hide the kit's scripts.
  const kept = lines.filter((l, i) => {
    const t = l.trim();
    if (['.factory', '.factory/'].includes(t)) return false;
    // Drop the old line's own comment too, so it isn't left dangling.
    return !(t.startsWith('#') && /factory/i.test(t) && ['.factory', '.factory/'].includes(lines[i + 1]?.trim()));
  });
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  write(file, `${kept.join('\n')}${kept.length ? '\n\n' : ''}# factory evidence (screenshots, reports)\n.factory/evidence/\n`);
  changes.push('.gitignore (.factory/evidence/)');
}

function ensurePrTemplate(root, changes) {
  const file = join(root, '.github', 'pull_request_template.md');
  const current = read(file);
  const scaffold = readFileSync(join(SCAFFOLD, '.github', 'pull_request_template.md'), 'utf8');
  if (current === null) {
    write(file, scaffold);
    changes.push('.github/pull_request_template.md (new)');
  } else if (!/^##\s+Verify routes/im.test(current)) {
    write(file, `${current.trimEnd()}\n\n## Verify routes\n<!-- Pages CI should screenshot, comma separated, e.g. /, /pricing. -->\n/\n`);
    changes.push('.github/pull_request_template.md (added "Verify routes")');
  }
}

function copyKit(root, changes) {
  for (const rel of listFiles(KIT)) {
    const src = join(KIT, rel);
    const dest = join(root, rel);
    if (read(dest) === readFileSync(src, 'utf8')) continue;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    changes.push(rel);
  }
  const map = join(root, 'docs', 'factory', 'feature-map.md');
  if (!existsSync(map)) {
    write(map, readFileSync(join(SCAFFOLD, 'docs', 'factory', 'feature-map.md'), 'utf8'));
    changes.push('docs/factory/feature-map.md (new; fill it in)');
  }
}

function loadRepoConfig(root) {
  const file = join(root, 'factory.json');
  const text = read(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    die(`factory.json is not valid JSON: ${err.message}`);
  }
}

function withDefaults(cfg) {
  return { branch: 'main', node: '22', setup: [], gates: [], app: null, protect: [], ...cfg, worker: { model: 'claude-opus-5-5', maxTurns: 150, tools: [], ...cfg.worker } };
}

function defaultBranch(root) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/^origin\//, '');
  } catch {
    return null;
  }
}

// ---------- commands ----------

function install(root, { init }) {
  const changes = [];
  let cfg = loadRepoConfig(root);
  let notes = [];
  if (!cfg) {
    if (!init) die('factory.json is missing. Run `factory init` first.');
    const detected = detect(root);
    notes = detected.notes;
    cfg = { kit: VERSION, ...detected.cfg, branch: defaultBranch(root) ?? detected.cfg.branch, worker: { model: 'claude-opus-5-5', maxTurns: 150, tools: [] } };
    write(join(root, 'factory.json'), JSON.stringify(cfg, null, 2) + '\n');
    changes.push('factory.json (detected; review it)');
  } else if (cfg.kit !== VERSION) {
    cfg.kit = VERSION;
    write(join(root, 'factory.json'), JSON.stringify(cfg, null, 2) + '\n');
    changes.push(`factory.json (kit version ${VERSION})`);
  }
  cfg = withDefaults(cfg);

  copyKit(root, changes);
  mergeSettings(root, cfg, changes);
  ensureGitignore(root, changes);
  ensurePrTemplate(root, changes);
  upsertAgents(root, cfg, changes);

  process.stdout.write(`factory ${init ? 'init' : 'update'} (${VERSION}) in ${root}\n`);
  if (changes.length) for (const c of changes) ok(c);
  else ok('already up to date');
  if (notes.length) {
    process.stdout.write('\nWhat it detected:\n');
    for (const n of notes) process.stdout.write(`  - ${n}\n`);
  }
  if (init) {
    process.stdout.write(`\nNext:\n  1. Review factory.json (gates, app.start, protect).\n  2. Run \`node .factory/gates.mjs\` until it passes.\n  3. Run \`factory doctor\`, then commit on a branch and open a PR.\n`);
  }
}

function doctor(root) {
  let problems = 0;
  const bad = (msg) => {
    problems++;
    warn(msg);
  };
  process.stdout.write(`factory doctor in ${root}\n`);

  const raw = loadRepoConfig(root);
  if (!raw) {
    bad('factory.json is missing. Run `factory init`.');
    return;
  }
  const cfg = withDefaults(raw);
  ok(`factory.json: ${cfg.gates.length} gates${cfg.app ? ', browser check on' : ', no app'}; protected branch ${cfg.branch}`);
  if (!cfg.gates.length && !cfg.app) bad('factory.json has no gates and no app, so agents cannot prove anything. Add at least one gate.');
  if (raw.kit !== VERSION) bad(`kit version is ${raw.kit ?? 'unknown'}, this kit is ${VERSION}. Run \`factory update\`.`);

  const stale = listFiles(KIT).filter((rel) => read(join(root, rel)) !== readFileSync(join(KIT, rel), 'utf8'));
  if (stale.length) bad(`kit files missing or changed: ${stale.join(', ')}. Run \`factory update\`.`);
  else ok('kit files match this version');

  const settings = read(join(root, '.claude', 'settings.json')) ?? '';
  if (settings.includes('.factory/guard.mjs')) ok('guard hook wired in .claude/settings.json');
  else bad('guard hook is not in .claude/settings.json. Run `factory update`.');
  if ((read(join(root, 'AGENTS.md')) ?? '').includes(BLOCK_START)) ok('AGENTS.md has the factory rules');
  else bad('AGENTS.md has no factory section. Run `factory update`.');
  if (!(read(join(root, 'CLAUDE.md')) ?? '').includes('@AGENTS.md')) bad('CLAUDE.md does not import AGENTS.md.');
  if ((read(join(root, 'docs', 'factory', 'feature-map.md')) ?? '').includes('| TODO |')) warn('docs/factory/feature-map.md is still the empty template.');

  // Deploy-on-push workflows let a pushed commit reach production. The factory needs a human gate there.
  const wfDir = join(root, '.github', 'workflows');
  if (existsSync(wfDir)) {
    for (const name of readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('factory-'))) {
      const text = readFileSync(join(wfDir, name), 'utf8');
      const onPush = /^\s*push:/m.test(text) && (new RegExp(`branches:[^\\n]*\\b${cfg.branch}\\b`).test(text) || new RegExp(`-\\s*${cfg.branch}\\s*$`, 'm').test(text));
      const looksLikeDeploy = /deploy|release|publish|ssh|vercel|netlify|fly|wrangler|aws|gcloud/i.test(text);
      if (onPush && looksLikeDeploy && !text.includes('github.repository_owner')) {
        bad(`${name} deploys on every push to ${cfg.branch} with no owner check. Add \`if: github.actor == github.repository_owner\` to its deploy job.`);
      }
    }
    // A broken workflow file fails silently on GitHub (the worker just never starts), so lint when we can.
    const lint = spawnSync('actionlint', ['-shellcheck=', '-pyflakes='], { cwd: root, encoding: 'utf8' });
    if (lint.error) warn('actionlint not installed, so workflow files were not checked (brew install actionlint).');
    else if (lint.status === 0) ok('workflow files are valid (actionlint)');
    else bad(`workflow files have errors:\n${lint.stdout.trim()}`);
  }

  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root);
  if (!repo.ok) {
    warn('GitHub checks skipped: `gh` is not signed in or the repo has no GitHub remote.');
  } else {
    const labels = gh(['label', 'list', '--search', 'factory', '--json', 'name', '-q', '.[].name'], root);
    if (labels.out.split('\n').includes('factory')) ok('label "factory" exists');
    else bad(`label "factory" is missing: gh label create factory --color B60205 --repo ${repo.out}`);
    const secrets = gh(['secret', 'list', '--repo', repo.out, '--json', 'name', '-q', '.[].name'], root);
    if (secrets.out.split('\n').includes('CLAUDE_CODE_OAUTH_TOKEN')) ok('secret CLAUDE_CODE_OAUTH_TOKEN is set');
    else bad(`secret CLAUDE_CODE_OAUTH_TOKEN is missing: run \`factory secret\` in ${root}`);
    const onDefault = gh(['api', `repos/${repo.out}/contents/.github/workflows/factory-worker.yml`, '--silent'], root);
    if (onDefault.ok) ok(`factory workflows are on ${cfg.branch}`);
    else warn(`factory workflows are not on ${cfg.branch} yet, so labelling an issue does nothing until the setup PR is merged.`);
    warn('Make sure the Claude GitHub app can see this repo: https://github.com/apps/claude (choose "All repositories" once).');
  }

  process.stdout.write(problems ? `\n${problems} thing(s) to fix.\n` : '\nAll good.\n');
  process.exitCode = problems ? 1 : 0;
}

function secret(root, { save }) {
  if (process.platform !== 'darwin') die('`factory secret` uses the macOS Keychain. Elsewhere run: gh secret set CLAUDE_CODE_OAUTH_TOKEN');
  if (save) {
    process.stdout.write('Paste your token from `claude setup-token` when asked (input is hidden).\n');
    const res = spawnSync('security', ['add-generic-password', '-U', '-a', process.env.USER, '-s', KEYCHAIN_SERVICE, '-w'], { stdio: 'inherit' });
    if (res.status !== 0) die('could not save the token to the Keychain.');
    ok('token saved in the Keychain. Run `factory secret` in each repo to use it.');
    if (!existsSync(join(root, '.git'))) return;
  }
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], root);
  if (!repo.ok) die('this folder has no GitHub repo `gh` can see.');
  const token = spawnSync('security', ['find-generic-password', '-a', process.env.USER, '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' });
  if (token.status !== 0 || !token.stdout.trim()) die('no token in the Keychain yet. Run `claude setup-token`, then `factory secret --save`.');
  const set = spawnSync('gh', ['secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', repo.out], { input: token.stdout.trim(), encoding: 'utf8' });
  if (set.status !== 0) die(`gh could not set the secret: ${set.stderr.trim()}`);
  ok(`CLAUDE_CODE_OAUTH_TOKEN set on ${repo.out}`);
}

const [command = 'help', ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith('--'));
const target = rest.find((a) => !a.startsWith('--')) ?? process.cwd();

switch (command) {
  case 'init':
    install(repoRoot(target), { init: true });
    break;
  case 'update':
    install(repoRoot(target), { init: false });
    break;
  case 'doctor':
    doctor(repoRoot(target));
    break;
  case 'secret':
    secret(flags.includes('--save') && !rest.some((a) => !a.startsWith('--')) ? process.cwd() : repoRoot(target), { save: flags.includes('--save') });
    break;
  case 'help':
  case '--help':
  case '-h':
    process.stdout.write(HELP);
    break;
  default:
    die(`unknown command "${command}". Run \`factory help\`.`);
}
