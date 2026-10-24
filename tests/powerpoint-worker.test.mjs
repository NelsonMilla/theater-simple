// Runs the real slideshow worker under Windows PowerShell 5.1. Where PowerPoint is not
// installed (such as the CI runner), it proves the worker parses, enables busy-retry,
// and reports the failing step with PowerPoint's own COM error code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const powerPointInstalled = windows && spawnSync('reg', ['query', 'HKCR\\PowerPoint.Application'], {windowsHide: true}).status === 0;

async function runWorker(t, name, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'theater-worker-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true, maxRetries: 3}));
  const input = path.join(directory, name);
  await fs.writeFile(input, bytes);
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'run-slideshow.ps1'), '-PresentationPath', input], {windowsHide: true});
  child.stdin.end();
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  const line = stdout.split(/\r?\n/).find(text => text.startsWith('{'));
  assert.ok(line, `Worker printed no JSON reply. Exit ${code}. stdout: ${stdout} stderr: ${stderr}`);
  return JSON.parse(line);
}

test('slideshow worker names the failing step and COM code when PowerPoint is missing', {skip: !windows ? 'Windows only' : powerPointInstalled ? 'PowerPoint is installed here; use tests/powerpoint-live.windows.mjs' : false}, async t => {
  const reply = await runWorker(t, 'Presentation.pptx', await fs.readFile(path.join(root, 'tests', 'fixtures', 'animation-rehearsal.pptx')));
  assert.equal(reply.id, 0);
  assert.match(reply.error, /could not start Microsoft PowerPoint/);
  assert.match(reply.error, /Details: step app, code 0x80040154/, 'REGDB_E_CLASSNOTREG from PowerPoint.Application');
  assert.doesNotMatch(reply.error, /busy-retry off/, 'The COM busy-retry filter must compile and register');
});

test('slideshow worker passes validation messages through unchanged', {skip: !windows && 'Windows only'}, async t => {
  const reply = await runWorker(t, 'Presentation.pptx', 'not a zip package');
  assert.equal(reply.id, 0);
  assert.doesNotMatch(reply.error, /Details: step/);
  assert.ok(reply.error.length > 0);
});
