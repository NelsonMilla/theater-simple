import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {createPowerPointPreparer, preparePowerPoint} from '../lib/powerpoint.mjs';

const pdf = Buffer.from('%PDF-1.7\nStatic-slide export fixture\n%%EOF\n');

async function folder(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'theater-powerpoint-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true, maxRetries: 3}));
  return directory;
}

async function input(directory, name = 'deck.pptx', bytes = 'unchanged original deck') {
  const filename = path.join(directory, name);
  await fs.writeFile(filename, bytes);
  return filename;
}

// A minimal ZIP writer keeps the preflight fixtures independent of Office or third-party packages.
function zip(entries) {
  const locals = [], directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), content = Buffer.from(text), crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, content);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + content.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test('prepares from a unique copy and publishes a complete static PDF without changing source', async t => {
  const directory = await folder(t);
  const source = await input(directory);
  const output = path.join(directory, 'result.pdf');
  const prepare = createPowerPointPreparer({runConverter: async options => {
    assert.notEqual(options.inputPath, source);
    assert.equal(path.basename(options.inputPath), 'presentation.pptx');
    assert.equal(await fs.readFile(options.inputPath, 'utf8'), 'unchanged original deck');
    await fs.writeFile(options.outputPath, pdf);
  }});
  assert.deepEqual(await prepare({inputPath: source, outputPath: output}), {outputPath: output, engine: 'powerpoint', staticSlides: true});
  assert.deepEqual(await fs.readFile(output), pdf);
  assert.equal(await fs.readFile(source, 'utf8'), 'unchanged original deck');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['deck.pptx', 'result.pdf']);
});

test('serializes separate conversions and coalesces duplicate requests', async t => {
  const directory = await folder(t);
  const source = await input(directory);
  let active = 0, highWater = 0, calls = 0;
  const prepare = createPowerPointPreparer({runConverter: async ({outputPath}) => {
    calls++; active++; highWater = Math.max(highWater, active);
    await delay(20);
    await fs.writeFile(outputPath, pdf);
    active--;
  }});
  const first = {inputPath: source, outputPath: path.join(directory, 'one.pdf')};
  const a = prepare(first), b = prepare(first), c = prepare({...first, outputPath: path.join(directory, 'two.pdf')});
  assert.equal(a, b);
  await Promise.all([a, b, c]);
  assert.equal(calls, 2);
  assert.equal(highWater, 1);
});

test('failed conversion never publishes partial output and does not block the next conversion', async t => {
  const directory = await folder(t);
  const source = await input(directory);
  const output = path.join(directory, 'slides.pdf');
  await fs.writeFile(output, pdf);
  let fail = true;
  const prepare = createPowerPointPreparer({runConverter: async ({outputPath}) => {
    await fs.writeFile(outputPath, '%PDF-partial');
    if (fail) { fail = false; throw new Error('PowerPoint timed out'); }
    await fs.writeFile(outputPath, pdf);
  }});
  await assert.rejects(prepare({inputPath: source, outputPath: output}), /timed out/);
  assert.deepEqual(await fs.readFile(output), pdf);
  await prepare({inputPath: source, outputPath: output});
  assert.deepEqual((await fs.readdir(directory)).sort(), ['deck.pptx', 'slides.pdf']);
});

test('rejects missing or incomplete converter output', async t => {
  const directory = await folder(t);
  const source = await input(directory);
  const output = path.join(directory, 'slides.pdf');
  const empty = createPowerPointPreparer({runConverter: async () => {}});
  await assert.rejects(empty({inputPath: source, outputPath: output}), /did not create slides/);
  const partial = createPowerPointPreparer({runConverter: ({outputPath}) => fs.writeFile(outputPath, '%PDF-1.7\nNot yet complete export')});
  await assert.rejects(partial({inputPath: source, outputPath: output}), /complete PDF/);
  await assert.rejects(fs.access(output), {code: 'ENOENT'});
});

test('legacy or macro-enabled files require a PDF/PPTX instead of unsafe automatic opening', async t => {
  const directory = await folder(t);
  let called = false;
  const prepare = createPowerPointPreparer({runConverter: async () => { called = true; }});
  for (const extension of ['ppt', 'pps', 'pptm', 'exe']) {
    const source = await input(directory, `deck.${extension}`);
    await assert.rejects(prepare({inputPath: source, outputPath: path.join(directory, 'result.pdf')}), /save this older PowerPoint file as .pptx or PDF/);
  }
  assert.equal(called, false);
});

test('Windows preflight refuses external content relationships before opening Office', {skip: process.platform !== 'win32'}, async t => {
  const directory = await folder(t);
  for (const [name, relation] of Object.entries({
    remote: '<Relationship Id="x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/private.png" TargetMode="External"/>',
    local: '<Relationship Id="x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="file:///C:/private.xlsx"/>',
  })) {
    const source = await input(directory, `${name}.pptx`, zip({'ppt/presentation.xml': '<p/>', 'ppt/_rels/presentation.xml.rels': `<Relationships>${relation}</Relationships>`}));
    await assert.rejects(preparePowerPoint({inputPath: source, outputPath: path.join(directory, `${name}.pdf`)}), /links to external media or data/);
  }
});

test('Windows preflight rejects active controls and XML entity expansion before opening Office', {skip: process.platform !== 'win32'}, async t => {
  const directory = await folder(t);
  const active = await input(directory, 'active.pptx', zip({'ppt/presentation.xml': '<p/>', 'ppt/activeX/activeX1.bin': 'not executed'}));
  await assert.rejects(preparePowerPoint({inputPath: active, outputPath: path.join(directory, 'active.pdf')}), /macros or active controls/);
  const xml = await input(directory, 'xml.pptx', zip({'ppt/presentation.xml': '<p/>', '_rels/.rels': '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/private.txt">]><x>&e;</x>'}));
  await assert.rejects(preparePowerPoint({inputPath: xml, outputPath: path.join(directory, 'xml.pdf')}), /DTD|Dtd|prohibited/);
});
