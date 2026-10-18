import { test } from 'node:test';
import assert from 'node:assert/strict';
import live from '../desktop/powerpoint.cjs';
test('automatic PowerPoint capture selects exactly its owned slideshow HWND, never a title match or screen', () => {
  const sources = [{ id: 'screen:42:0', name: 'Presentation' }, { id: 'window:142:0', name: 'PowerPoint Slide Show' }, { id: 'window:42:0', name: 'Anything' }];
  assert.equal(live.findSlideshowSource(sources, '42'), sources[2]);
  assert.equal(live.findSlideshowSource(sources, '43'), undefined);
  assert.equal(live.findSlideshowSource(sources, '../42'), undefined);
});
test('native slideshow rejects unknown ids, legacy files, and unrecognized commands before launching Office', async () => {
  const show = new live.PowerPointShow({ origin: 'http://127.0.0.1:1', directory: 'unused', spawnWorker() { throw new Error('must not launch'); }, fetchFile: async () => Response.json({ files: [{ id: 'old', type: 'powerpoint', name: 'old.ppt' }] }) });
  await assert.rejects(show.start('../secret'), /saved PowerPoint/);
  await assert.rejects(show.start('missing'), /no longer available/);
  await assert.rejects(show.start('old'), /older presentation/);
  await assert.rejects(show.command('run'), /Unknown slideshow action/);
});
