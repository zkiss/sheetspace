import { describe, expect, it } from 'vitest';
import { sheetDocument } from '@test/workbookFactories';
import { addressRangeOf, cellAddressOf, cellIdentityAt, cellIdentityFromKey, cellIdentityKey, stableRangeAt } from '@workbook/core/cellIdentity';

describe('stableCellIdentity', () => {
  it('converts between ordered position and stable identity in both directions', () => {
    const document = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 2, columnCount: 2 });
    const identity = cellIdentityAt(document.content, 'B2');

    expect(identity).toEqual({ rowId: 'sheet-1:row:2', columnId: 'sheet-1:column:2' });
    expect(cellAddressOf(document.content, identity!)).toEqual({ rowIndex: 1, columnIndex: 1 });
    expect(cellIdentityFromKey(cellIdentityKey(identity!))).toEqual(identity);
  });

  it('converts exact range corners to stable identities and back', () => {
    const content = sheetDocument({ id: 'sheet-1', name: 'Inputs', rowCount: 3, columnCount: 3 }).content;
    const positional = {
      start: { rowIndex: 1, columnIndex: 0 },
      end: { rowIndex: 2, columnIndex: 2 },
    };
    const stable = stableRangeAt(content, positional);

    expect(stable).toEqual({
      start: { rowId: 'sheet-1:row:2', columnId: 'sheet-1:column:1' },
      end: { rowId: 'sheet-1:row:3', columnId: 'sheet-1:column:3' },
    });
    expect(addressRangeOf(content, stable!)).toEqual(positional);
  });
});
