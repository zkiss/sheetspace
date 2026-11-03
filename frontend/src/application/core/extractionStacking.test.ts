import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { ContentHistory } from './contentHistory';
import { extractSelection } from './extractSelection';
import { prepareExtractionReplay } from './extractionHistory';

const targetId = '00000000-0000-0000-0000-000000000001';
const rowId = '00000000-0000-0000-0000-000000000002';
const columnId = '00000000-0000-0000-0000-000000000003';

describe('extraction stacking', () => {
  it.each(['cells', 'rows', 'columns'] as const)('includes insertion in the %s extraction snapshot', (kind) => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const neighbor = sheetDocument({ id: 'neighbor', name: 'Neighbor', rowCount: 1, columnCount: 1 });
    source.frame.zIndex = 1; neighbor.frame.zIndex = 1;
    const workbook = workbookWithSheets([source, neighbor]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    const selection = kind === 'cells' ? { kind, start: cell, end: cell } as const : kind === 'rows'
      ? { kind, start: cell.rowId, end: cell.rowId } as const : { kind, start: cell.columnId, end: cell.columnId } as const;
    const result = extractSelection(workbook, { sourceSheetId: source.id, selection, targetSheetId: targetId, targetName: 'Target', targetRows: [rowId], targetColumns: [columnId], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 1 } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.workbook.documents[targetId]!.frame.zIndex).toBe(1);
    expect(result.workbook.documents.neighbor!.frame.zIndex).toBe(2);
    expect(result.workbook.documents[targetId]!.content.cells[cellIdentityKey({ rowId, columnId })]).toBe('42');
    expect(workbook.documents.neighbor!.frame.zIndex).toBe(1);
  });

  it('replays the adjacent frame change with extracted data in one history entry', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const neighbor = sheetDocument({ id: 'neighbor', name: 'Neighbor', rowCount: 1, columnCount: 1 });
    source.frame.zIndex = 1; neighbor.frame.zIndex = 1;
    const before = workbookWithSheets([source, neighbor]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    const result = extractSelection(before, { sourceSheetId: source.id, selection: { kind: 'cells', start: cell, end: cell }, targetSheetId: targetId, targetName: 'Target', targetRows: [rowId], targetColumns: [columnId], frame: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, zIndex: 1 } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.workbook.documents.neighbor!.frame.zIndex).toBe(2);
    const history = new ContentHistory(); history.recordExtraction(before, result.workbook);
    const stale = structuredClone(result.workbook); stale.documents.neighbor!.frame.zIndex = 4;
    expect(prepareExtractionReplay(stale, history.peekUndo()!, 'undo')).toEqual({ ok: false, reason: 'stale-extraction-history' });
    const undo = prepareExtractionReplay(result.workbook, history.peekUndo()!, 'undo');
    expect(undo.ok && undo.workbook).toEqual(before); if (!undo.ok) return;
    history.commitUndo();
    const redo = prepareExtractionReplay(undo.workbook, history.peekRedo()!, 'redo');
    expect(redo.ok && redo.workbook).toEqual(result.workbook);
    expect(result.workbook.documents[targetId]!.content.cells[cellIdentityKey({ rowId, columnId })]).toBe('42');
  });
});
