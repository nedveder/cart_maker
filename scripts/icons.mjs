/**
 * Generate the extension's icons from a single embedded SVG.
 *
 *   - Writes `src/icons/icon.svg` (the source)
 *   - Renders 16/32/48/128 px PNGs into `src/icons/`
 *
 * Run after editing the SVG below. The PNGs are committed to the repo so
 * the regular build doesn't depend on this script.
 *
 *   npm run icons
 */
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'src/icons');
mkdirSync(outDir, { recursive: true });

// 128×128 source. Blue→indigo gradient rounded square + white shopping
// cart with an inset checkmark — same glyph as the in-app CartLogo so the
// brand reads consistently across the toolbar icon, the panel header, and
// the minimized pill.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#bg)"/>
  <g transform="translate(16 16) scale(4)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18l-2 11a2 2 0 0 1-2 1.7H7a2 2 0 0 1-2-1.7L3 6Z"/>
    <path d="M9 6V4a3 3 0 0 1 6 0v2"/>
    <path d="M9 11l2 2 4-4"/>
  </g>
</svg>
`;

writeFileSync(join(outDir, 'icon.svg'), svg);

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`[icons] generated icon-${size}.png`);
}
