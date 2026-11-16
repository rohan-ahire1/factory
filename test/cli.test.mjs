import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'factory.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('help prints usage and exits 0', () => {
  const r = run('help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /factory 1\./);
  assert.match(r.stdout, /init/);
});

test('unknown command exits 1', () => {
  const r = run('nonsense');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
});
