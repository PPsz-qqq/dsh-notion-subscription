import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const files = ['index.js', 'models.js', 'reasoning.js', 'options.js', 'catalog.js', 'http.js', 'discovery.js', 'capture.js', 'messages.js', 'stream.js', 'transport.js'];
await mkdir(new URL('lib/', root), { recursive: true });
for (const file of files) await copyFile(new URL(`src/${file}`, root), new URL(`lib/${file}`, root));
const client = await readFile(new URL('src/client.cjs', root), 'utf8');
// DSH loads lazy CJS factories, not a standalone Vite application.
const bundle = `window.__ModuleLoader__.load({\n  id: "dsh-notion-subscription",\n  factory: (require) => {\n    const module = { exports: {} };\n${client}\n    return module.exports;\n  }\n});\n`;
await writeFile(new URL('lib/client.js', root), bundle, 'utf8');
console.log(`Built host and DSH client factory in ${fileURLToPath(new URL('lib/', root))}`);
