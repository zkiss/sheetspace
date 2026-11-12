import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { CONTENT_HISTORY_MAX_BYTES, ContentHistory } from './contentHistory';
import { captureLocalRecord, replayLocalRecord } from './localRecordReplay';
import { RecordReplayOwner } from './recordReplayOwner';

function endpoints() {
  const sheet = sheetDocument({ id: 'target', name: 'Target', rowCount: 1, columnCount: 2, cells: { A1: 'old' } });
  const dependent = sheetDocument({ id: 'dependent', name: 'Dependent', rowCount: 2, columnCount: 1 });
  const before = workbookWithSheets([sheet, dependent]);
  const key = cellIdentityKey({ rowId: 'new', columnId: sheet.content.columns[0]! });
  const after = { ...before, documents: { ...before.documents,
    target: { ...sheet, content: { ...sheet.content, rows: ['new', ...sheet.content.rows], cells: { ...sheet.content.cells, [key]: '=canonical' } } },
    dependent: { ...dependent, content: { ...dependent.content, rows: [...dependent.content.rows].reverse() } },
  } };
  return { before, after, key, delta: captureLocalRecord(before, after, 'target', 'new') };
}

describe('local admission record replay', () => {
  it('replays exact cells and dependent orders while preserving unrelated content and presentation', () => {
    const { before, after, delta } = endpoints();
    const target = after.documents.target!;
    const unrelated = cellIdentityKey({ rowId: target.content.rows[1]!, columnId: target.content.columns[1]! });
    const edited = { ...after, documents: { ...after.documents, target: { ...target, name: 'Renamed', content: { ...target.content, cells: { ...target.content.cells, [unrelated]: 'edit' } } } } };
    const undone = replayLocalRecord(edited, delta, 'undo');
    expect(undone.documents.target!.content.rows).toEqual(before.documents.target!.content.rows);
    expect(undone.documents.dependent!.content.rows).toEqual(before.documents.dependent!.content.rows);
    expect(undone.documents.target!.content.cells[unrelated]).toBe('edit');
    expect(undone.documents.target!.name).toBe('Renamed');
    const redone = replayLocalRecord(undone, delta, 'redo');
    expect(redone).toEqual(edited);
    expect(replayLocalRecord(redone, delta, 'undo')).toEqual(undone);
  });

  it('rejects missing sheets, changed orders, conflicting cells and missing columns without mutation', () => {
    const { after, delta, key } = endpoints();
    const missing: Workbook = structuredClone(after); delete missing.documents.dependent;
    const order = structuredClone(after); order.documents.dependent!.content.rows.reverse();
    const cell = structuredClone(after); cell.documents.target!.content.cells[key] = 'changed';
    const column = structuredClone(after); column.documents.target!.content.columns = [];
    const target: Workbook = structuredClone(after); delete target.documents.target;
    for (const workbook of [missing, order, cell, column, target]) {
      const original = structuredClone(workbook);
      expect(() => replayLocalRecord(workbook, delta, 'undo')).toThrow();
      expect(workbook).toEqual(original);
    }
  });

  it('copies and budgets local metadata, clearing redo on oversized admission', () => {
    const { delta } = endpoints();
    const history = new ContentHistory();
    history.recordModelRecord({ sheetId: 'target', rowId: 'new' }, delta);
    const peek = history.peekUndo()!;
    expect(peek.bytes).toBeGreaterThan(JSON.stringify(delta).length);
    delta.orders[0]!.before.push('external');
    peek.localRecord!.orders[0]!.before.push('peek');
    expect(history.peekUndo()!.localRecord!.orders[0]!.before).not.toContain('external');
    expect(history.peekUndo()!.localRecord!.orders[0]!.before).not.toContain('peek');
    history.commitUndo();
    history.recordModelRecord({ sheetId: 'target', rowId: 'new' }, { ...delta, cells: { large: 'x'.repeat(CONTENT_HISTORY_MAX_BYTES) } });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('keeps the history cursor on endpoint rejection and rejects occupied redo cells', async () => {
    const { before, after, delta, key } = endpoints();
    const history = new ContentHistory();
    history.recordModelRecord({ sheetId: 'target', rowId: 'new' }, delta);
    const owner = new RecordReplayOwner(history);
    const conflict = structuredClone(after); conflict.documents.target!.content.cells[key] = 'other';
    await expect(owner.replay(history.peekUndo()!, 'undo', async () => replayLocalRecord(conflict, delta, 'undo'))).rejects.toThrow();
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    const occupied = structuredClone(before); occupied.documents.target!.content.cells[key] = 'other';
    expect(() => replayLocalRecord(occupied, delta, 'redo')).toThrow();
  });

  it('evicts older local entries when their combined metadata exceeds the normal budget', () => {
    const { delta } = endpoints();
    const history = new ContentHistory();
    const large = { ...delta, cells: { large: 'x'.repeat(CONTENT_HISTORY_MAX_BYTES / 2) } };
    history.recordModelRecord({ sheetId: 'target', rowId: 'one' }, large);
    const first = history.peekUndo()!.identity;
    history.recordModelRecord({ sheetId: 'target', rowId: 'two' }, large);
    expect(history.peekUndo()!.identity).not.toBe(first);
    history.commitUndo();
    expect(history.canUndo).toBe(false);
  });
});
