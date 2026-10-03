#!/usr/bin/env node
// Managed by the factory kit: `factory update` overwrites this file. Configure the app in factory.json → "app".
// Drives the real app in a browser and proves pages work: status, console errors, failed requests,
// sideways scroll, headings, alt text and internal links. Writes screenshots plus report.json / report.md
// to an evidence folder. Exit code 1 when a check fails, 2 when the setup is wrong.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadConfig, ROOT } from './config.mjs';

const HELP = `verify: drive the app in a real browser and collect proof

Usage: node .factory/verify.mjs [options]

  --start            run factory.json "app.start" on a free port (after a build), stop it after
  --base-url URL     app to check (default: factory.json "app.url", else http://localhost:3000)
  --routes /a,/b     only check these paths (default: factory.json "app.routes", "sitemap" = every URL in /sitemap.xml)
  --shots /a,/b      paths to screenshot; "all" for every checked route (default: --routes, else /)
  --video            also record a video per screenshot route
  --out DIR          evidence folder (default .factory/evidence/<timestamp>)
  --json             print the JSON report instead of the summary
  --doctor           only check the setup (browser, server) and exit
  --install          install Playwright and Chromium if missing, then exit
  --help             show this help

Examples:
  node .factory/verify.mjs --start --shots /,/pricing
  node .factory/verify.mjs --base-url http://localhost:5173 --routes /settings --shots all --video
`;

const DEFAULT_VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900 },
];

function fail(message) {
  process.stderr.write(`verify: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { start: false, video: false, json: false, doctor: false, install: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value. Run with --help for usage.`);
      return v;
    };
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === '--start') opts.start = true;
    else if (arg === '--video') opts.video = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--doctor') opts.doctor = true;
    else if (arg === '--install') opts.install = true;
    else if (arg === '--base-url') opts.baseUrl = next().replace(/\/$/, '');
    else if (arg === '--routes') opts.routes = splitPaths(next());
    else if (arg === '--shots') opts.shots = next() === 'all' ? 'all' : splitPaths(argv[i]);
    else if (arg === '--out') opts.out = next();
    else fail(`Unknown option "${arg}". Run with --help for usage.`);
  }
  return opts;
}

function splitPaths(value) {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`));
}

// Playwright comes from the repo if it has it, otherwise from a shared cache installed on first use,
// so repos don't need a new dependency to use the factory.
const CACHE = process.env.FACTORY_PLAYWRIGHT_DIR ?? join(homedir(), '.cache', 'factory-kit', 'playwright');

function playwrightDir({ install }) {
  for (const base of [ROOT, CACHE]) {
    try {
      return dirname(createRequire(join(base, 'package.json')).resolve('playwright/package.json'));
    } catch {}
  }
  if (!install) return null;
  process.stderr.write(`verify: Playwright is not in this repo; installing it once into ${CACHE}\n`);
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(join(CACHE, 'package.json'))) writeFileSync(join(CACHE, 'package.json'), '{ "private": true }\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', 'playwright@1'], { cwd: CACHE, stdio: 'inherit' });
  return dirname(createRequire(join(CACHE, 'package.json')).resolve('playwright/package.json'));
}

function installChromium(dir) {
  const args = [join(dir, 'cli.js'), 'install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium'];
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startServer(app) {
  if (!app.start) fail('factory.json has no "app.start" command. Add one, or drop --start and pass --base-url.');
  const port = await freePort();
  const command = app.start.replaceAll('$PORT', String(port));
  // Own process group, so stopping it also stops whatever `npm run`/`npx` spawned underneath.
  const child = spawn(command, { cwd: ROOT, shell: true, detached: true, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  };
  const baseUrl = `http://localhost:${port}`;
  if (!(await waitForServer(`${baseUrl}${app.ready ?? '/'}`, (app.timeout ?? 60) * 1000))) {
    stop();
    fail(`"${command}" did not answer on ${baseUrl} within ${app.timeout ?? 60}s. Did the build run first?\nServer output:\n${log.slice(-3000)}`);
  }
  return { baseUrl, stop };
}

async function discoverRoutes(baseUrl, configured) {
  if (Array.isArray(configured) && configured.length) return configured;
  const res = await fetch(`${baseUrl}/sitemap.xml`).catch(() => null);
  if (!res || !res.ok) return ['/'];
  const xml = await res.text();
  const paths = [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => new URL(m[1]).pathname))];
  return paths.length ? paths : ['/'];
}

const slugify = (path) => (path === '/' ? 'home' : path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'));

async function checkPage(browser, baseUrl, route, viewport, { shot, video, out, ignore }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: 'reduce',
    ...(video && shot ? { recordVideo: { dir: join(out, 'video'), size: { width: viewport.width, height: viewport.height } } } : {}),
  });
  const page = await context.newPage();
  const problems = [];
  const warnings = [];
  const origin = new URL(baseUrl).origin;

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`uncaught exception: ${err.message}`));
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith(origin) && res.status() >= 400 && url !== `${baseUrl}${route}`) {
      problems.push(`request failed ${res.status()}: ${url.slice(origin.length)}`);
    }
  });

  let status = 0;
  try {
    const res = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
    status = res?.status() ?? 0;
  } catch (err) {
    problems.push(`page did not load: ${err.message.split('\n')[0]}`);
  }
  if (status >= 400) problems.push(`HTTP ${status}`);

  const facts = await page
    .evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: document.querySelectorAll('h1').length,
      noAlt: [...document.images].filter((img) => !img.hasAttribute('alt')).map((img) => img.getAttribute('src')),
      links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
      title: document.title,
    }))
    .catch(() => null);

  if (facts) {
    if (facts.overflow > 1) problems.push(`page scrolls sideways by ${facts.overflow}px (something is wider than the screen)`);
    if (facts.h1 === 0) problems.push('no <h1> on the page');
    if (facts.h1 > 1) warnings.push(`${facts.h1} <h1> elements (expected 1)`);
    for (const src of facts.noAlt) problems.push(`image without alt attribute: ${src}`);
    if (!facts.title) problems.push('empty <title>');
  }

  let screenshot = null;
  if (shot && status && status < 400) {
    screenshot = join(out, `${slugify(route)}--${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch((e) => warnings.push(`screenshot failed: ${e.message}`));
  }
  const videoPath = video && shot ? await page.video()?.path() : null;
  await context.close();

  const ignored = (msg) => ignore.some((re) => re.test(msg));
  return {
    route,
    viewport: viewport.name,
    status,
    problems: problems.filter((m) => !ignored(m)),
    warnings: [...warnings, ...problems.filter(ignored).map((m) => `ignored by factory.json: ${m}`)],
    screenshot,
    video: videoPath ?? null,
    links: facts?.links ?? [],
  };
}

async function checkLinks(links, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const internal = [...new Set(links.filter((l) => l.startsWith(origin)).map((l) => l.split('#')[0]))];
  const broken = [];
  await Promise.all(
    internal.map(async (url) => {
      const res = await fetch(url, { redirect: 'follow' }).catch(() => null);
      if (!res || res.status >= 400) broken.push({ url: url.slice(origin.length) || '/', status: res?.status ?? 'no response' });
    }),
  );
  return broken;
}

function toMarkdown(report, viewports) {
  const lines = [`# Verify report`, '', `${report.ok ? 'PASS' : 'FAIL'}: ${report.routes.length} routes x ${viewports.length} viewports at ${report.baseUrl}`, ''];
  const failing = report.pages.filter((p) => p.problems.length);
  if (failing.length || report.brokenLinks.length) {
    lines.push('## Problems', '');
    for (const p of failing) for (const msg of p.problems) lines.push(`- \`${p.route}\` (${p.viewport}): ${msg}`);
    for (const l of report.brokenLinks) lines.push(`- broken internal link \`${l.url}\` (${l.status})`);
    lines.push('');
  }
  const warned = report.pages.filter((p) => p.warnings.length);
  if (warned.length) {
    lines.push('## Warnings', '');
    for (const p of warned) for (const msg of p.warnings) lines.push(`- \`${p.route}\` (${p.viewport}): ${msg}`);
    lines.push('');
  }
  lines.push('## Pages', '', '| Route | Viewport | Status | Problems |', '|---|---|---|---|');
  for (const p of report.pages) lines.push(`| ${p.route} | ${p.viewport} | ${p.status} | ${p.problems.length} |`);
  return lines.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    fail(err.message);
  }
  const app = cfg.app ?? {};
  const viewports = app.viewports ?? DEFAULT_VIEWPORTS;
  const ignore = (app.ignore ?? []).map((pattern) => new RegExp(pattern, 'i'));

  const dir = playwrightDir({ install: opts.install || !!process.env.CI });
  if (!dir) fail('Playwright is missing. Run `node .factory/verify.mjs --install` once (installs Playwright and Chromium).');
  if (opts.install) {
    installChromium(dir);
    process.stdout.write('verify: Playwright and Chromium are ready.\n');
    return;
  }
  const { chromium } = createRequire(join(dir, 'package.json'))('playwright');

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    fail(`Chromium could not start (${err.message.split('\n')[0]}). Run \`node .factory/verify.mjs --install\`.`);
  }

  const server = opts.start ? await startServer(app) : null;
  const baseUrl = opts.baseUrl ?? server?.baseUrl ?? app.url ?? 'http://localhost:3000';
  const cleanup = async () => {
    await browser.close();
    server?.stop();
  };

  if (!(await waitForServer(baseUrl, opts.start ? 1000 : 5000))) {
    await cleanup();
    fail(`Nothing is answering at ${baseUrl}. Start the app first, or use --start after a build.`);
  }

  if (opts.doctor) {
    await cleanup();
    process.stdout.write(`verify doctor: ok (chromium launches, ${baseUrl} answers)\n`);
    return;
  }

  const routes = opts.routes ?? (await discoverRoutes(baseUrl, app.routes));
  const shots = new Set(opts.shots === 'all' ? routes : opts.shots ?? (opts.routes ? routes : ['/']));
  const out = opts.out ?? join('.factory', 'evidence', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });

  const pages = [];
  for (const route of routes) {
    for (const viewport of viewports) {
      pages.push(await checkPage(browser, baseUrl, route, viewport, { shot: shots.has(route), video: opts.video, out, ignore }));
    }
  }
  const brokenLinks = await checkLinks(pages.flatMap((p) => p.links), baseUrl);
  await cleanup();

  const report = {
    ok: pages.every((p) => p.problems.length === 0) && brokenLinks.length === 0,
    baseUrl,
    out,
    routes,
    brokenLinks,
    pages: pages.map(({ links, ...rest }) => rest),
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const md = toMarkdown(report, viewports);
  writeFileSync(join(out, 'report.md'), md);

  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(`${md}\nEvidence: ${out}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => fail(err.stack ?? String(err)));
