/**
 * Bundle the built extension into a release-ready zip.
 *
 *   1. Run the production build (`npm run build`).
 *   2. Zip the contents of `dist/` into `cart_maker-<version>.zip` at repo root.
 *
 * Users download that zip, unzip it, and load the resulting folder via
 * chrome://extensions → Developer mode → "Load unpacked".
 *
 * Requires the `zip` command (preinstalled on macOS / most Linux). Windows
 * users without it can run `npm run build` and zip `dist/` manually, or use
 * WSL / 7-zip.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `cart_maker-${pkg.version}.zip`;
const zipPath = join(root, zipName);

console.log('[package] running build...');
execSync('npm run build', { stdio: 'inherit', cwd: root });

if (existsSync(zipPath)) rmSync(zipPath);

console.log(`[package] zipping dist/ → ${zipName}`);
execSync(`zip -r "${zipPath}" .`, {
  stdio: 'inherit',
  cwd: join(root, 'dist'),
});

console.log(`[package] done: ${zipPath}`);
