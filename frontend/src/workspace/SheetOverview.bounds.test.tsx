import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SheetOverview } from '@workspace/SheetOverview';
import { sheetDocument } from '@test-support/workbookFactories';
import { tabularProjection } from '@workbook/read/queries';

// jsdom has no layout engine. Evaluate the rendered affine coordinates against
// the rendered size/translation, rather than merely checking that a
// mark exists or repeating its expected inline style.
function coordinate(value: string, extent: number) {
  expect(value).toMatch(/^calc\(.*\)$/);
  let result = 0;
  const remainder = value.slice(5, -1).replace(/([+-]?)\s*([\d.]+)(px|%)/g, (_, sign, amount, unit) => {
    result += (sign === '-' ? -1 : 1) * Number(amount) * (unit === '%' ? extent / 100 : 1);
    return '';
  });
  expect(remainder.trim(), `Unsupported overview coordinate: ${value}`).toBe('');
  return result;
}

describe('SheetOverview sampled mark bounds', () => {
  it.each([
    { name: 'first cell', address: 'A1', columnCount: 4, rowCount: 4 },
    { name: 'final column only', address: 'D2', columnCount: 4, rowCount: 4 },
    { name: 'final row only', address: 'B4', columnCount: 4, rowCount: 4 },
    { name: 'bottom-right only', address: 'D4', columnCount: 4, rowCount: 4 },
    { name: 'single column at final row', address: 'A4', columnCount: 1, rowCount: 4 },
    { name: 'single row at final column', address: 'D1', columnCount: 4, rowCount: 1 },
    { name: 'single cell', address: 'A1', columnCount: 1, rowCount: 1 },
    { name: 'large sparse bottom-right only', address: 'CV10000', columnCount: 100, rowCount: 10_000 },
  ])('keeps the complete $name mark inside the data area', ({ address, columnCount, rowCount }) => {
    const sheet = tabularProjection(sheetDocument({
      id: 'sheet-bounds', name: 'Bounds', cells: { [address]: 'populated' }, columnCount, rowCount,
    }));
    const { container } = render(<SheetOverview isActive={false} onSelect={() => {}} sheet={sheet} />);
    const marks = container.querySelectorAll<HTMLElement>('.sheet-overview-data-mark');
    expect(marks).toHaveLength(1);
    const mark = marks[0];
    const grid = container.querySelector<HTMLElement>('.sheet-overview-grid')!;
    const translation = /^translate\(([\d.]+)px,\s*([\d.]+)px\)$/.exec(mark.style.transform);
    expect(translation).not.toBeNull();

    // Local extents vary with frame resize. Scaling the complete overview then
    // scales both the clipping area and the mark, preserving these inequalities.
    for (const { width, height } of [{ width: 114, height: 66 }, { width: 234, height: 126 }, { width: 794, height: 594 }]) {
      const left = coordinate(mark.style.left, width) + Number(translation![1]);
      const top = coordinate(mark.style.top, height) + Number(translation![2]);
      expect(left).toBeGreaterThanOrEqual(parseFloat(grid.style.getPropertyValue('--overview-row-header-width')));
      expect(top).toBeGreaterThanOrEqual(parseFloat(grid.style.getPropertyValue('--overview-column-header-height')));
      expect(left + parseFloat(mark.style.width)).toBeLessThanOrEqual(width - Number(translation![1]));
      expect(top + parseFloat(mark.style.height)).toBeLessThanOrEqual(height - Number(translation![2]));
    }
  });
});
