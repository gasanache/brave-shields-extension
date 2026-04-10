import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';

// Single source of truth for the shield icon. The popup keeps an inline copy
// for CSS-driven theming (drop-shadow, disabled-state filter); this script
// renders the same artwork into the toolbar PNGs Chrome loads from manifest
// `icons` and `action.default_icon`.
const ICONS_DIR = path.resolve(__dirname, '..', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'shield.svg');
const SIZES = [16, 48, 128];

const svg = fs.readFileSync(SVG_PATH);

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  });
  const png = resvg.render().asPng();
  const outPath = path.join(ICONS_DIR, `shield-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`  -> shield-${size}.png (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log('Done.');
