import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkbookController } from '@application/react/useWorkbookController';
import type { ClipboardParseResult } from '@application/core/clipboardPayload';
import { ClipboardPayloadStore } from '@grid/clipboardPayload';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
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
  it('keeps sparse appearance records through copy, paste, clear, move, and content undo', () => {
    const presentation = {
      rowHeights: {}, columnWidths: {}, formatOverrides: {
        rows: {}, columns: {}, cells: {
          'sheet:row:1\u0000sheet:column:1': { fontWeight: 'bold' as const },
          'sheet:row:1\u0000sheet:column:2': { fillColor: '#abcdef' as const },
          'sheet:row:1\u0000sheet:column:3': { textColor: '#123456' as const },
        },
      },
    };
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 3, cells: { A1: 'source', B1: 'destination', C1: 'paste target' }, presentation });
    const workbook = workbookWithSheets([sheet]);
    const store = new ClipboardPayloadStore();
    const copiedPayload = store.copy(workbook, { mode: 'cells', anchor: cellTargetAt(sheet, 'A1')!, extent: cellTargetAt(sheet, 'A1')! });
    if (!copiedPayload.ok) throw new Error('copy failed');
    const copied = store.parse(workbook, copiedPayload.value);
    const cut = store.cut(workbook, { mode: 'cells', anchor: cellTargetAt(sheet, 'A1')!, extent: cellTargetAt(sheet, 'A1')! });
    if (!cut.ok) throw new Error('cut failed');
    const parsedCut = store.parse(workbook, cut.value);
    if (!parsedCut.ok || parsedCut.value.kind !== 'cut') throw new Error('cut did not parse');
    const cutSource = parsedCut.value.source;
    const calculate = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ calculationObserver: calculate, initialWorkbook: workbook }));
    calculate.mockClear();

    act(() => expect(result.current.commands.pasteCells(sheet.id, 'C1', copied)).toEqual({ ok: true, changed: true }));
    act(() => result.current.commands.updateCellContent(sheet.id, 'C1', ''));
    act(() => expect(result.current.commands.moveCells(sheet.id, 'B1', cutSource)).toEqual({ ok: true, changed: true }));

    const current = findSheetById(result.current.workbook, sheet.id)!;
    expect(current.presentation).toEqual(presentation);
    expect(cellRawContent(current, 'A1')).toBeUndefined();
    expect(cellRawContent(current, 'B1')).toBe('source');
    expect(cellRawContent(current, 'C1')).toBeUndefined();
    expect(calculate).toHaveBeenCalledTimes(3);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.commands.undo());
    const undone = findSheetById(result.current.workbook, sheet.id)!;
    expect(undone.presentation.formatOverrides?.cells[cellIdentityKey(cellIdentityAt(undone.content, 'A1')!)]).toEqual({ fontWeight: 'bold' });
    expect(undone.presentation.formatOverrides?.cells[cellIdentityKey(cellIdentityAt(undone.content, 'B1')!)]).toEqual({ fillColor: '#abcdef' });
    expect(undone.presentation.formatOverrides?.cells[cellIdentityKey(cellIdentityAt(undone.content, 'C1')!)]).toEqual({ textColor: '#123456' });
    expect(cellRawContent(undone, 'A1')).toBe('source');
    expect(cellRawContent(undone, 'B1')).toBe('destination');
  });

  it('moves a range through one write operation and rejects invalid destinations without side effects', async () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 2, columnCount: 3, cells: { A1: 'one', B1: 'two' } });
    const destination = sheetDocument({ id: 'destination', name: 'Destination', rowCount: 2, columnCount: 3 });
    const workbook = workbookWithSheets([source, destination]);
    const store = new ClipboardPayloadStore();
    const cut = store.cut(workbook, { mode: 'cells', anchor: cellTargetAt(source, 'A1')!, extent: cellTargetAt(source, 'B1')! });
    if (!cut.ok) throw new Error('cut failed');
    const parsed = store.parse(workbook, cut.value);
    if (!parsed.ok || parsed.value.kind !== 'cut') throw new Error('cut did not parse');
    const cutSource = parsed.value.source;
    const apiClient = autosaveClient();
    const calculate = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ apiClient, calculationObserver: calculate, initialWorkbook: workbook }));
    calculate.mockClear();

    act(() => expect(result.current.commands.moveCells(destination.id, 'B1', cutSource)).toEqual({ ok: true, changed: true }));
    expect(cellRawContent(findSheetById(result.current.workbook, source.id)!, 'A1')).toBeUndefined();
    expect(cellRawContent(findSheetById(result.current.workbook, destination.id)!, 'B1')).toBe('one');
    expect(calculate).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiClient.writeCells).toHaveBeenCalledOnce());
    expect(vi.mocked(apiClient.writeCells).mock.calls[0]![0]).toEqual(expect.arrayContaining([
      { sheetId: source.id, revision: 0 }, { sheetId: destination.id, revision: 0 },
    ]));

    const moved = result.current.workbook;
    act(() => expect(result.current.commands.moveCells(destination.id, 'ZZ999', cutSource)).toEqual({ ok: false, reason: 'invalid-destination' }));
    act(() => expect(result.current.commands.moveCells('missing', 'A1', cutSource)).toEqual({ ok: false, reason: 'invalid-destination' }));
    expect(result.current.workbook).toBe(moved);
  });

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

  it('rejects a missing paste destination without changing the workbook', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet' });
    const workbook = workbookWithSheets([sheet]);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => {
      expect(result.current.commands.pasteCells(sheet.id, 'ZZ999', { ok: true, value: { kind: 'external', grid: { rowCount: 1, columnCount: 1, rows: [['value']] } } }))
        .toEqual({ ok: false, reason: 'invalid-destination' });
    });
    expect(result.current.workbook).toBe(workbook);
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
