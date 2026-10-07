import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('output/image-fixture');
mkdirSync(directory, { recursive: true });
const html = readFileSync('packages/web/index.html', 'utf8').replace('src="/src/main.tsx"', 'src="./image-app.tsx"').replace('<title>Hermes Remote Web</title>', '<title>DEMO ONLY — image fixture</title>');
writeFileSync('scripts/fixtures/image-index.html', html);
await build({ configFile: 'packages/web/vite.config.ts', root: resolve('scripts/fixtures'), publicDir: false,
  define: { __REMOTE_BUILD_ID__: JSON.stringify('DEMO-image-fixture') },
  build: { outDir: directory, emptyOutDir: false, rollupOptions: { input: resolve('scripts/fixtures/image-index.html') } } });
renameSync(`${directory}/image-index.html`, `${directory}/index.html`);
writeFileSync(`${directory}/build.json`, JSON.stringify({ buildId: 'DEMO-image-fixture', fixtureOnly: true }) + '\n');
console.log('DEMO image shell: output/image-fixture; NEVER deploy this directory.');
