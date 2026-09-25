import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkbookController } from '@application/react/useWorkbookController';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellTargetAt } from '@grid/cellInteraction';
import { formulaRawForStorage } from '@workbook/formula/reference';
import { cellRawContent, findSheetById } from '@workbook/read/queries';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

function parsedInternalClipboard(workbook: ReturnType<typeof workbookWithSheets>, sheet: ReturnType<typeof sheetDocument>) {
  const store = new ClipboardPayloadStore();
  const copied = store.copy(workbook, {
    mode: 'cells',
    anchor: cellTargetAt(sheet, 'A1')!,
    extent: cellTargetAt(sheet, 'B1')!,
  });
  if (!copied.ok) throw new Error('copy failed');
  return store.parse(workbook, copied.value);
}

describe('useWorkbookController paste', () => {
  it('applies a parsed internal range as one content, calculation, persistence, and history transaction', async () => {
    const seed = sheetDocument({
      id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 3,
      cells: { B2: 'old', C2: 'old blank' }, presentation: { rowHeights: { 'sheet:row:2': 31 }, columnWidths: { 'sheet:column:2': 90 } },
    });
    const seededWorkbook = workbookWithSheets([seed]);
    const sheet = {
      ...seed,
      content: { ...seed.content, cells: { ...seed.content.cells, [seed.content.rows[0]! + '\u0000' + seed.content.columns[0]!]: formulaRawForStorage('=B1', seededWorkbook, seed.id) } },
    };
    const workbook = workbookWithSheets([sheet]);
    const clipboard = parsedInternalClipboard(workbook, sheet);
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ apiClient, calculationObserver: calculate, initialWorkbook: workbook }));
    calculate.mockClear();
    const presentation = findSheetById(result.current.workbook, sheet.id)!.presentation;

    act(() => {
      expect(result.current.commands.pasteCells(sheet.id, 'B2', clipboard)).toEqual({ ok: true, changed: true });
    });

    const pasted = findSheetById(result.current.workbook, sheet.id)!;
    expect(cellRawContent(pasted, 'B2')).toBe('=@[sheet:column:3,sheet:row:2]');
    expect(cellRawContent(pasted, 'C2')).toBeUndefined();
    expect(pasted.presentation).toBe(presentation);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenLastCalledWith({ kind: 'cells', cells: [{ sheetId: sheet.id, key: 'B2' }, { sheetId: sheet.id, key: 'C2' }] });
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(1));
    expect(apiClient.writeCells).toHaveBeenCalledWith(
      [{ sheetId: sheet.id, revision: 0 }],
      expect.arrayContaining([
        expect.objectContaining({ rowId: 'sheet:row:2', columnId: 'sheet:column:2', raw: '=@[sheet:column:3,sheet:row:2]' }),
        expect.objectContaining({ rowId: 'sheet:row:2', columnId: 'sheet:column:3', raw: '' }),
      ]),
    );
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.commands.undo());
    expect(cellRawContent(findSheetById(result.current.workbook, sheet.id)!, 'B2')).toBe('old');
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(cellRawContent(findSheetById(result.current.workbook, sheet.id)!, 'B2')).toBe('=@[sheet:column:3,sheet:row:2]');
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledTimes(3));
  });

  it('uses external parser results as newly entered destination formulas', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const store = new ClipboardPayloadStore();
    const external = store.parse(workbook, { text: '=A1' });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => {
      expect(result.current.commands.pasteCells(sheet.id, 'B2', external)).toEqual({ ok: true, changed: true });
    });

    expect(cellRawContent(findSheetById(result.current.workbook, sheet.id)!, 'B2')).toBe('=@[sheet:column:1,sheet:row:1]');
  });

  it('suppresses calculation, persistence, and history for malformed and no-op parser results', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const store = new ClipboardPayloadStore();
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ apiClient, calculationObserver: calculate, initialWorkbook: workbook }));
    calculate.mockClear();

    act(() => {
      expect(result.current.commands.pasteCells(sheet.id, 'A1', store.parse(workbook, { text: '"unterminated' }))).toEqual({ ok: false, reason: 'malformed-tsv' });
      expect(result.current.commands.pasteCells(sheet.id, 'A1', store.parse(workbook, { text: '' }))).toEqual({ ok: true, changed: false });
    });

    expect(result.current.workbook).toBe(workbook);
    expect(result.current.canUndo).toBe(false);
    expect(calculate).not.toHaveBeenCalled();
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });

  it('rejects a later untranslatable internal formula without partially pasting or emitting side effects', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', cells: { A1: 'first', B1: 'second' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', cells: { B2: 'old first', C2: 'old second' } });
    const workbook = workbookWithSheets([source, destination]);
    const clipboard = {
      ok: true,
      value: {
        kind: 'internal',
        grid: { rowCount: 1, columnCount: 2, rows: [['first', '=broken']] },
        source: {
          sheetId: source.id,
          dimensions: { rowCount: 1, columnCount: 2 },
          cells: [[
            { identity: cellIdentityAt(source.content, 'A1')!, raw: 'first' },
            { identity: cellIdentityAt(source.content, 'B1')!, raw: '=#REF!@[source:column:1,source:row:1]' },
          ]],
        },
      },
    } satisfies ClipboardParseResult;
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ apiClient, calculationObserver: calculate, initialWorkbook: workbook }));
    calculate.mockClear();

    act(() => {
      expect(result.current.commands.pasteCells(destination.id, 'B2', clipboard)).toEqual({ ok: false, reason: 'formula-transform-failed' });
    });

    expect(result.current.workbook).toBe(workbook);
    expect(cellRawContent(findSheetById(result.current.workbook, destination.id)!, 'B2')).toBe('old first');
    expect(cellRawContent(findSheetById(result.current.workbook, destination.id)!, 'C2')).toBe('old second');
    expect(result.current.canUndo).toBe(false);
    expect(calculate).not.toHaveBeenCalled();
    expect(apiClient.writeCells).not.toHaveBeenCalled();
  });
});
