import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { historyRevealTarget } from './historyRevealTarget';
import { measuredElementGeometry, testRect } from '@test-support/domGeometry';

describe('history cell workspace geometry', () => {
  it('predicts internal reveal for a culled sheet, including grid-end clamping and sheet scale', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History', position: { x: 100, y: 200 }, visualScale: 2 });
    const target = historyRevealTarget(sheet, cellIdentityAt(sheet.content, 'J20')!, null)!;
    expect(target.right).toBe(100 + 239 * 2);
    expect(target.bottom).toBe(200 + 159 * 2);
    expect(target.left).toBe(target.right - 76 * 2);
    expect(target.bottom - target.top).toBeCloseTo(26.4 * 2);
  });

  it('uses measured scrollport geometry and preserves offsets on already visible axes', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History', position: { x: 50, y: 50 } });
    const frame = document.createElement('article');
    frame.className = 'sheet-frame';
    const scrollport = document.createElement('div');
    frame.append(scrollport);
    measuredElementGeometry(scrollport, { width: 300, height: 180 });
    // Measured body offsets can differ from the fallback. Combined sheet and
    // viewport transforms must not turn rendered pixels into logical offsets.
    frame.getBoundingClientRect = () => testRect({ left: 25, top: 40, width: 480, height: 400 });
    scrollport.getBoundingClientRect = () => testRect({ left: 27, top: 136, width: 600, height: 360 });
    scrollport.scrollLeft = 100;
    scrollport.scrollTop = 30;
    const target = historyRevealTarget(sheet, cellIdentityAt(sheet.content, 'C3')!, scrollport)!;
    expect(target.left).toBe(50 + 1 + 40 + 152 - 100);
    expect(target.top).toBeCloseTo(50 + 48 + 26.4 + 52.8 - 30);
    expect(target.right - target.left).toBe(76);
    expect(target.bottom - target.top).toBeCloseTo(26.4);
  });

  it('clips oversized cells to the revealed scrollport and respects pending axis slots', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History' });
    sheet.presentation = { rowHeights: { [sheet.content.rows[0]]: 200 }, columnWidths: { [sheet.content.columns[0]]: 400 } };
    const target = historyRevealTarget(sheet, cellIdentityAt(sheet.content, 'A1')!, null, {
      rows: [{ kind: 'creating', operationId: 'row', boundary: 0 }],
      columns: [{ kind: 'creating', operationId: 'column', boundary: 0 }],
    });
    expect(target).toEqual({ left: 41, right: 239, top: 59.4, bottom: 159 });
  });

  it('ignores removed history identities', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History' });
    expect(historyRevealTarget(sheet, { rowId: 'removed', columnId: sheet.content.columns[0] }, null)).toBeUndefined();
  });
});
