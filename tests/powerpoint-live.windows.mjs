// Explicit opt-in integration test: opens the generated fixture in installed PowerPoint.
// node tests/powerpoint-live.windows.mjs <path-to-animation-rehearsal.pptx>
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import live from '../desktop/powerpoint.cjs';
const fixture = await fs.readFile(process.argv[2]);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'theater-live-test-'));
const show = new live.PowerPointShow({ origin: 'http://127.0.0.1:1', directory, fetchFile: async url => url.endsWith('/api/state') ? Response.json({ files: [{ id: 'fixture', type: 'powerpoint', name: 'Animation.pptx' }] }) : new Response(fixture) });
try {
  const opened = await show.start('fixture');
  assert.equal(opened.slide, 1); assert.equal(opened.click, 0); assert.equal(opened.clicks, 2);
  console.log('Opened slideshow with two click-triggered animations.');
  await show.command('next'); await delay(1200);
  const first = await show.command('status'); assert.equal(first.slide, 1); assert.equal(first.click, 1);
  console.log('Next played first animation and stayed on slide 1.');
  await show.command('next'); await delay(1200);
  const second = await show.command('status'); assert.equal(second.slide, 1); assert.equal(second.click, 2);
  console.log('Next played second animation and stayed on slide 1.');
  await show.command('next'); await delay(400);
  assert.equal((await show.command('status')).slide, 2);
  await show.command('previous'); await delay(400);
  assert.equal((await show.command('status')).slide, 1);
  console.log('Slide advance and previous both operate on the same slideshow.');
} finally { await show.close(); await fs.rm(directory, { recursive: true, force: true }); }
assert.equal(show.child.exitCode, 0);
console.log('Owned slideshow closed cleanly.');
