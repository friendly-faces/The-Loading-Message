// Astro emits a JS chunk for every island it sees imported in a page,
// even branches that are never rendered (e.g. the OfflineCounter island in
// a public build, or the Counter island in an offline build). Those chunks
// aren't referenced from any built HTML, but they still ship in dist/ and
// could leak code we'd rather not publish.
//
// This script walks dist/, finds every _astro/*.js chunk that no HTML file
// references, and deletes it (recursively, since deleting a chunk can orphan
// chunks it imported).

import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const all = await walk(DIST);
const htmlFiles = all.filter((p) => p.endsWith('.html'));
const jsChunks = all.filter((p) => p.includes('/_astro/') && p.endsWith('.js'));

async function readAll(files) {
  return Promise.all(files.map((f) => readFile(f, 'utf8')));
}

let removed = 0;
for (let pass = 0; pass < 10; pass++) {
  const htmlBlobs = await readAll(htmlFiles);
  const liveJs = jsChunks.filter(async () => true);
  const survivors = [];
  const remaining = [];

  // Build the haystack: all HTML + all currently-surviving JS chunks.
  const aliveJs = [];
  for (const chunk of jsChunks) {
    try {
      await stat(chunk);
      aliveJs.push(chunk);
    } catch {
      // already deleted
    }
  }
  const jsBlobs = await readAll(aliveJs);
  const haystack = htmlBlobs.join('\n') + '\n' + jsBlobs.join('\n');

  let didDelete = false;
  for (const chunk of aliveJs) {
    const name = chunk.slice(chunk.lastIndexOf('/') + 1);
    if (!haystack.includes(name)) {
      await unlink(chunk);
      removed++;
      didDelete = true;
    }
  }
  if (!didDelete) break;
}

console.log(`prune-orphans: removed ${removed} orphan chunk(s)`);
