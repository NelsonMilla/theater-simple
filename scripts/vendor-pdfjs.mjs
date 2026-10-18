import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'node_modules', 'pdfjs-dist');
const destination = path.join(root, 'public', 'vendor', 'pdfjs');
const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (metadata.version !== '6.4.299') throw new Error('Install the locked PDF.js 6.4.299 dependency before generating browser assets.');
await fs.mkdir(destination, {recursive: true});
for (const [from, to] of [['legacy/build/pdf.min.mjs', 'pdf.js'], ['legacy/build/pdf.worker.min.mjs', 'pdf.worker.js'], ['LICENSE', 'LICENSE']]) {
  await fs.copyFile(path.join(source, from), path.join(destination, to));
}
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await fs.cp(path.join(source, directory), path.join(destination, directory), {recursive: true});
}
console.log('Generated PDF.js 6.4.299 browser assets, including original license notices.');
