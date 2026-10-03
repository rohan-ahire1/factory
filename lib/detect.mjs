// Looks at a repo and guesses a starting factory.json: how to install, which checks to run,
// and how to serve the app. Every guess is listed in `notes` so a human or Claude can review it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const has = (root, ...files) => files.some((f) => existsSync(join(root, f)));
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function packageManager(root) {
  if (has(root, 'pnpm-lock.yaml')) return { name: 'pnpm', setup: ['corepack enable', 'pnpm install --frozen-lockfile'], run: (s) => `pnpm run ${s}` };
  if (has(root, 'yarn.lock')) return { name: 'yarn', setup: ['corepack enable', 'yarn install'], run: (s) => `yarn ${s}` };
  if (has(root, 'bun.lockb', 'bun.lock')) return { name: 'bun', setup: ['npm install -g bun', 'bun install'], run: (s) => `bun run ${s}` };
  if (has(root, 'package-lock.json')) return { name: 'npm', setup: ['npm ci --no-audit --no-fund'], run: (s) => (s === 'test' ? 'npm test' : `npm run ${s}`) };
  return { name: 'npm', setup: ['npm install --no-audit --no-fund'], run: (s) => (s === 'test' ? 'npm test' : `npm run ${s}`) };
}

function nodeGates(pkg, pm, root) {
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const gates = [];
  const typecheck = ['typecheck', 'type-check', 'check-types', 'tsc'].find((s) => scripts[s]);
  if (typecheck) gates.push({ name: 'Typecheck', run: pm.run(typecheck) });
  else if (deps.typescript && has(root, 'tsconfig.json')) gates.push({ name: 'Typecheck', run: 'npx tsc --noEmit' });
  if (scripts.lint) gates.push({ name: 'Lint', run: pm.run('lint') });
  const placeholderTest = /no test specified/.test(scripts.test ?? '');
  if (scripts.test && !placeholderTest) gates.push({ name: 'Tests', run: pm.run('test') });
  else {
    for (const s of Object.keys(scripts).filter((k) => /^test:/.test(k) && !/watch|ui|dev|e2e/.test(k))) {
      gates.push({ name: `Tests (${s.slice(5)})`, run: pm.run(s) });
    }
  }
  if (scripts.build) gates.push({ name: 'Build', run: pm.run('build') });
  return gates;
}

function nodeApp(pkg, pm) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  if (deps.next) return { start: 'npx next start -p $PORT', why: 'Next.js' };
  if (deps.astro) return { start: 'npx astro preview --port $PORT', why: 'Astro' };
  if (deps.nuxt) return { start: 'node .output/server/index.mjs', why: 'Nuxt (reads $PORT)' };
  if (deps['@remix-run/serve'] || deps['@react-router/serve']) return { start: `${pm.run('start')}`, why: 'Remix / React Router (reads $PORT)' };
  if (deps.vite || deps['@sveltejs/kit']) return { start: 'npx vite preview --port $PORT --strictPort', why: 'Vite' };
  if (deps['react-scripts']) return { start: 'npx -y serve -s build -l $PORT', why: 'Create React App' };
  if (deps.react || deps.vue || deps.svelte || deps['solid-js']) {
    if (scripts.start) return { start: pm.run('start'), why: 'frontend framework with a start script (check it reads $PORT)' };
  }
  if (deps.express || deps.fastify || deps.koa || deps.hono) return null;
  return null;
}

function pythonGates(root) {
  const setup = [];
  const gates = [];
  if (has(root, 'uv.lock')) setup.push('pipx install uv', 'uv sync');
  else if (has(root, 'poetry.lock')) setup.push('pipx install poetry', 'poetry install');
  else if (has(root, 'requirements-dev.txt')) setup.push('python3 -m pip install -r requirements-dev.txt');
  else if (has(root, 'requirements.txt')) setup.push('python3 -m pip install -r requirements.txt');
  else if (has(root, 'pyproject.toml')) setup.push('python3 -m pip install -e .');
  const runner = has(root, 'uv.lock') ? 'uv run ' : has(root, 'poetry.lock') ? 'poetry run ' : 'python3 -m ';
  const pyproject = has(root, 'pyproject.toml') ? readFileSync(join(root, 'pyproject.toml'), 'utf8') : '';
  if (/\[tool\.ruff/.test(pyproject) || has(root, 'ruff.toml', '.ruff.toml')) gates.push({ name: 'Lint', run: `${runner}ruff check .` });
  if (has(root, 'tests', 'test', 'pytest.ini') || /\[tool\.pytest/.test(pyproject)) {
    if (!has(root, 'uv.lock', 'poetry.lock')) setup.push('python3 -m pip install pytest');
    gates.push({ name: 'Tests', run: `${runner}pytest -q` });
  }
  if (!gates.length) gates.push({ name: 'Compile', run: 'python3 -m compileall -q .' });
  return { setup, gates };
}

export function detect(root) {
  const notes = [];
  const cfg = { branch: 'main', node: '22', setup: [], gates: [], app: null, protect: ['.github/workflows/'] };

  for (const dir of ['ops', 'infra', 'deploy', 'terraform', 'k8s', '.devcontainer']) {
    if (existsSync(join(root, dir))) cfg.protect.unshift(`${dir}/`);
  }

  const pkg = readJson(join(root, 'package.json'));
  if (pkg) {
    const pm = packageManager(root);
    cfg.setup.push(...pm.setup);
    cfg.gates.push(...nodeGates(pkg, pm, root));
    const engine = pkg.engines?.node?.match(/\d+/)?.[0];
    if (engine && Number(engine) >= 20) cfg.node = engine;
    notes.push(`Node project (${pm.name}).`);
    const app = nodeApp(pkg, pm);
    if (app) {
      cfg.app = { start: app.start, routes: 'sitemap', ignore: [] };
      notes.push(`Web app: ${app.why}. Browser check serves it with "${app.start}".`);
    }
  }

  if (has(root, 'pyproject.toml', 'requirements.txt', 'setup.py')) {
    const py = pythonGates(root);
    cfg.setup.push(...py.setup);
    cfg.gates.push(...py.gates);
    notes.push('Python project.');
  }
  if (has(root, 'go.mod')) {
    cfg.setup.push('go mod download');
    cfg.gates.push({ name: 'Vet', run: 'go vet ./...' }, { name: 'Tests', run: 'go test ./...' }, { name: 'Build', run: 'go build ./...' });
    notes.push('Go project.');
  }
  if (has(root, 'Cargo.toml')) {
    cfg.gates.push({ name: 'Tests', run: 'cargo test' }, { name: 'Build', run: 'cargo build' });
    notes.push('Rust project.');
  }

  if (!cfg.gates.length && existsSync(join(root, 'Makefile'))) {
    const make = readFileSync(join(root, 'Makefile'), 'utf8');
    for (const target of ['lint', 'test', 'build']) if (new RegExp(`^${target}:`, 'm').test(make)) cfg.gates.push({ name: target[0].toUpperCase() + target.slice(1), run: `make ${target}` });
    if (cfg.gates.length) notes.push('Gates taken from the Makefile.');
  }

  const htmlAtRoot = readdirSync(root).some((f) => f === 'index.html');
  if (!pkg && htmlAtRoot) {
    cfg.app = { start: 'python3 -m http.server $PORT --bind 127.0.0.1', routes: 'sitemap', ignore: [] };
    notes.push('Static HTML site: the browser check serves the folder as is.');
  }

  if (!cfg.gates.length && !cfg.app) notes.push('No checks found. Add at least one gate to factory.json, or agents cannot prove anything.');
  if (!cfg.gates.length && cfg.app) notes.push('No build or test commands found; only the browser check runs.');
  return { cfg, notes };
}
