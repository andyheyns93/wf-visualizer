/**
 * Rasterize src/favicon.svg into the extension's PNG icons (Chrome/Edge require raster icons;
 * SVG isn't allowed for extension/toolbar icons). Uses Playwright's Chromium — no extra
 * dependency. Re-run after changing the SVG:  `node scripts/gen-icons.mjs`
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = 'src/extension/icons';

const svg = readFileSync('src/favicon.svg', 'utf8');
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><head><style>
         *{margin:0;padding:0}
         html,body{width:${size}px;height:${size}px}
         svg{display:block;width:${size}px;height:${size}px}
       </style></head><body>${svg}</body></html>`,
    );
    const buffer = await page.screenshot({ omitBackground: true });
    writeFileSync(`${OUT_DIR}/icon-${size}.png`, buffer);
    console.log(`wrote ${OUT_DIR}/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
