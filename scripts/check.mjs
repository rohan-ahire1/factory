import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['bin', 'lib', 'kit/.factory', 'scripts'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = dirs.flatMap((d) => walk(join(root, d)));
let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${file}\n${r.stderr}`);
  }
}
console.log(`checked ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
