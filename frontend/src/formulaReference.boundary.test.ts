import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from './test/workbookFactories';
import { cellRawContent } from './workbook/read/queries';
import { commitCellRawContent } from './workbook/mutations/operations';
import { formulaRawForDisplay, formulaRawForStorage } from './workbook/formula/reference';

describe('workbook formula storage and display boundary', () => {
  it('canonicalizes every anchor and preserves qualification and formatting', () => {
    const current = sheetDocument({ id: 'current', name: 'Current' });
    const sales = sheetDocument({ id: 'sales-id', name: 'Sales Q1' });
    const workbook = workbookWithSheets([current, sales]);
    const raw = "= SUM( A1, $B2, C$3, $D$4, 'Sales Q1'!A1:B2, Current!A1 )";

    const canonical = formulaRawForStorage(raw, workbook, current.id);

    expect(canonical).toBe(
      "= SUM( @[current:column:1,current:row:1], @[$current:column:2,current:row:2], @[current:column:3,$current:row:3], @[$current:column:4,$current:row:4], 'sales-id'!@[sales-id:column:1,sales-id:row:1]:@[sales-id:column:2,sales-id:row:2], current!@[current:column:1,current:row:1] )",
    );
    expect(formulaRawForDisplay(canonical, workbook, current.id)).toBe(raw);
  });

  it('keeps targets stable while current A1 labels and quoted sheet names change', () => {
    const current = sheetDocument({ id: 'current', name: 'Current' });
    const sales = sheetDocument({ id: 'sales-id', name: 'Sales Q1' });
    const initial = workbookWithSheets([current, sales]);
    const canonical = formulaRawForStorage("='Sales Q1'!$A1:B$2+A1", initial, current.id);
    const reorderedCurrent = {
      ...current,
      content: {
        ...current.content,
        rows: [current.content.rows[1], current.content.rows[0], ...current.content.rows.slice(2)],
        columns: [current.content.columns[1], current.content.columns[0], ...current.content.columns.slice(2)],
      },
    };
    const reorderedSales = {
      ...sales,
      name: "Owner's Plan",
      content: {
        ...sales.content,
        rows: [sales.content.rows[1], sales.content.rows[0], ...sales.content.rows.slice(2)],
        columns: [sales.content.columns[1], sales.content.columns[0], ...sales.content.columns.slice(2)],
      },
    };
    const reordered = workbookWithSheets([reorderedCurrent, reorderedSales]);

    expect(formulaRawForDisplay(canonical, initial, current.id)).toBe("='Sales Q1'!$A1:B$2+A1");
    expect(formulaRawForDisplay(canonical, reordered, current.id)).toBe("='Owner''s Plan'!$B2:A$1+B2");
    expect(formulaRawForStorage(formulaRawForDisplay(canonical, reordered, current.id), reordered, current.id))
      .toBe(canonical);
  });

  it('commits canonical strings and reopens them through the shared user formatter', () => {
    const current = sheetDocument({ id: 'current', name: 'Current' });
    const sales = sheetDocument({ id: 'sales-id', name: 'Sales Q1' });
    const workbook = workbookWithSheets([current, sales]);
    const committed = commitCellRawContent(
      workbook,
      current.id,
      'A1',
      "=SUM('Sales Q1'!A1:B2, A2)",
    );
    const stored = cellRawContent(committed.documents.current, 'A1');

    expect(stored).toBe(
      "=SUM('sales-id'!@[sales-id:column:1,sales-id:row:1]:@[sales-id:column:2,sales-id:row:2], @[current:column:1,current:row:2])",
    );
    expect(formulaRawForDisplay(stored!, committed, current.id))
      .toBe("=SUM('Sales Q1'!A1:B2, A2)");
  });
});
