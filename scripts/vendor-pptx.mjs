// Bundles the in-browser PowerPoint player (pptx-vanilla-viewer) and the OFL-licensed
// Carlito font into public/vendor/pptx, with the license text of every bundled package.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(root, 'public', 'vendor', 'pptx');
const pinned = {'pptx-vanilla-viewer': '3.50.1', '@fontsource/carlito': '5.3.0'};
for (const [name, version] of Object.entries(pinned)) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (metadata.version !== version) throw new Error(`Install the locked ${name} ${version} dependency before generating browser assets.`);
}

// Carlito's own stylesheets carry each subset's Unicode range; turn them into font faces the
// player registers at runtime, so no font list is copied by hand.
const fontDirectory = path.join(root, 'node_modules', '@fontsource', 'carlito');
const faces = [];
for (const sheet of ['400.css', '700.css', '400-italic.css', '700-italic.css']) {
  const css = await fs.readFile(path.join(fontDirectory, sheet), 'utf8');
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const field = name => block[1].match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    const file = field('src')?.match(/url\(\.\/(files\/[^)]+\.woff2)\)/)?.[1];
    if (!file) continue;
    faces.push({file: path.join(fontDirectory, file), weight: field('font-weight'), style: field('font-style'), unicodeRange: field('unicode-range')});
  }
}
if (faces.length < 20) throw new Error('Carlito font faces were not found.');
const carlitoFaces = {
  name: 'carlito-faces',
  setup(context) {
    context.onResolve({filter: /^theater:carlito-faces$/}, () => ({path: 'carlito-faces', namespace: 'theater'}));
    context.onLoad({filter: /.*/, namespace: 'theater'}, () => ({
      resolveDir: root,
      contents: faces.map((face, index) => `import f${index} from ${JSON.stringify(face.file)};`).join('\n')
        + `\nexport default [${faces.map((face, index) => `{url: f${index}, weight: ${JSON.stringify(face.weight)}, style: ${JSON.stringify(face.style)}, unicodeRange: ${JSON.stringify(face.unicodeRange || 'U+0-10FFFF')}}`).join(',')}];`,
    }));
  },
};

await fs.rm(destination, {recursive: true, force: true});
const result = await build({
  entryPoints: {'deck-player': path.join(root, 'src', 'pptx', 'deck-player.js')},
  outdir: destination, bundle: true, splitting: true, format: 'esm', minify: true, metafile: true,
  target: ['chrome120'], legalComments: 'none', logLevel: 'warning',
  loader: {'.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.otf': 'file', '.png': 'file', '.svg': 'file'},
  assetNames: 'assets/[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
  plugins: [carlitoFaces],
});

// One notice file for every npm package that ended up in the bundle.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.set(match[1], path.join(root, 'node_modules', ...match[1].split('/')));
}
let notices = 'Third-party software bundled in public/vendor/pptx by scripts/vendor-pptx.mjs.\n';
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const licenseFile = (await fs.readdir(directory)).find(file => /^(licen[cs]e|copying)(\.|$)/i.test(file));
  const text = licenseFile ? await fs.readFile(path.join(directory, licenseFile), 'utf8') : `License: ${metadata.license || 'see package metadata'}`;
  notices += `\n${'='.repeat(78)}\n${name} ${metadata.version} (${metadata.license || 'unknown license'})\n${'='.repeat(78)}\n${text.trim()}\n`;
}
await fs.writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), notices);
const files = await fs.readdir(destination, {recursive: true});
console.log(`Generated the PowerPoint player: ${files.length} files, ${packages.size} bundled packages, including license notices.`);
