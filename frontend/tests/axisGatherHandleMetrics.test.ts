// @vitest-environment node
import fs from 'node:fs';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';

it('contains header drag controls without covering neighboring row resize handles at different scales', async () => {
  const css = ['../src/app/global.css', '../src/grid/SheetGrid.css']
    .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ offline: true });
    for (const scale of [0.6, 1, 1.5]) {
      for (const height of [16, 26.4, 42]) {
        await page.setContent(`<!doctype html><style>${css}</style>
          <div class="sheet-grid" style="transform:scale(${scale});transform-origin:0 0;--grid-row-header-width:40px;--grid-cell-height:${height}px">
            ${[0, 1].map((row) => `<div class="sheet-grid-row" style="top:${row * height}px;height:${height}px">
              <div class="sheet-grid-row-header" style="height:${height}px;position:sticky;left:0">
                ${row + 1}<button class="sheet-grid-gather-handle">⋮⋮</button>
                <div role="separator" class="sheet-grid-resize-handle sheet-grid-resize-handle-row"></div>
              </div></div>`).join('')}
            <div class="sheet-grid-column-header" style="left:50px;top:0;width:76px;height:${height}px">
              A<button class="sheet-grid-gather-handle">⋮⋮</button>
            </div>
          </div>`);

        const geometry = await page.evaluate(() => {
          const contained = [...document.querySelectorAll('.sheet-grid-gather-handle')].every((handle) => {
            const button = handle.getBoundingClientRect(), header = handle.parentElement!.getBoundingClientRect();
            return button.top >= header.top && button.bottom <= header.bottom;
          });
          const resize = document.querySelector('[role="separator"]')!;
          const rect = resize.getBoundingClientRect();
          return { contained, resizeReachable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 5) === resize };
        });

        expect(geometry, `scale ${scale}, header height ${height}`).toEqual({ contained: true, resizeReachable: true });
      }
    }
  } finally { await browser.close(); }
}, 30_000);
