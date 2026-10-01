import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { historyRevealTarget } from './historyRevealTarget';

describe('history cell workspace geometry', () => {
  it('predicts internal reveal for a culled sheet, including grid-end clamping and sheet scale', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History', position: { x: 100, y: 200 }, visualScale: 2 });
    const target = historyRevealTarget(sheet, cellIdentityAt(sheet.content, 'J20')!, null)!;
    expect(target.right).toBe(100 + 240 * 2);
    expect(target.bottom).toBe(200 + 160 * 2);
    expect(target.left).toBe(target.right - 76 * 2);
    // Inner scroll offsets are rounded to pixels; the final row is clipped by 0.4px.
    expect(target.top).toBeCloseTo(468);
  });

  it('uses measured scrollport geometry and preserves offsets on already visible axes', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History', position: { x: 50, y: 50 } });
    const scrollport = { clientWidth: 300, clientHeight: 180, scrollLeft: 100, scrollTop: 30, offsetTop: 48, offsetLeft: 1 } as HTMLElement;
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
    expect(target).toEqual({ left: 40, right: 240, top: 68.8, bottom: 160 });
  });

  it('ignores removed history identities', () => {
    const sheet = sheetDocument({ id: 'history', name: 'History' });
    expect(historyRevealTarget(sheet, { rowId: 'removed', columnId: sheet.content.columns[0] }, null)).toBeUndefined();
  });
});
