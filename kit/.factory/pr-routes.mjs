#!/usr/bin/env node
// Managed by the factory kit: `factory update` overwrites this file.
// Reads a PR body from $PR_BODY and prints the routes listed under "## Verify routes" as a
// comma-separated list, defaulting to "/". Only plain paths are allowed, so the output is safe to pass on.

const body = process.env.PR_BODY ?? '';
const section = body.split(/^##\s+Verify routes\s*$/im)[1]?.split(/^##\s/m)[0] ?? '';
const routes = section
  .replace(/<!--[\s\S]*?-->/g, '')
  .split(/[\s,]+/)
  .map((r) => r.trim())
  .filter((r) => /^\/[A-Za-z0-9/_.-]*$/.test(r));

process.stdout.write([...new Set(routes)].join(',') || '/');
