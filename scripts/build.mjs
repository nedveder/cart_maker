import { build as esbuildBuild } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

console.log('[build] typechecking...');
execSync('tsc --noEmit', { stdio: 'inherit', cwd: root });

console.log('[build] cleaning dist/...');
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

console.log('[build] esbuild (popup, content, inject-main)...');
await esbuildBuild({
  entryPoints: [
    join(src, 'content.tsx'),
    join(src, 'popup.ts'),
    join(src, 'inject-main.ts'),
  ],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: dist,
  jsx: 'automatic',
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.css': 'text',
  },
  logLevel: 'info',
});

console.log('[build] copying static files...');
for (const file of ['manifest.json', 'popup.html']) {
  copyFileSync(join(src, file), join(dist, file));
}

console.log('[build] done. Load chrome-extension at:', dist);
