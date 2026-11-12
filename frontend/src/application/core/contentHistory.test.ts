import { describe, expect, it } from 'vitest';
import { CONTENT_HISTORY_MAX_BYTES, CONTENT_HISTORY_MAX_ENTRIES, ContentHistory } from './contentHistory';
import type { CellPersistenceWrite } from './userActions';

const affected = { sheetIds: ['sheet'], cells: [{ sheetId: 'sheet', cell: { rowId: 'row', columnId: 'column' } }] };
const write = (beforeRaw: string | null, afterRaw: string | null): CellPersistenceWrite => ({
  sheetId: 'sheet', rowId: 'row', columnId: 'column', beforeRaw, afterRaw,
});

describe('ContentHistory', () => {
  it('guards stack transfers by stable copied identity', () => {
    const history = new ContentHistory();
    history.recordModelRecord({ sheetId: 'sheet', rowId: 'row' });
    const id = history.peekUndo()!.identity;
    expect(history.peekUndo()!.identity).toBe(id);
    history.recordOrder({ sheetId: 'sheet', axis: 'row', before: ['a'], after: ['b'] });
    expect(history.commitGuarded('undo', id)).toBe(false);
    expect(history.peekUndo()!.kind).toBe('axis-order');
    history.commitUndo();
    expect(history.commitGuarded('undo', id)).toBe(true);
    expect(history.peekRedo()!.identity).toBe(id);
    expect(history.commitGuarded('redo', id)).toBe(true);
    history.record([write(null, 'edit')], affected);
    expect(history.commitGuarded('undo', id)).toBe(false);
    history.clear();
    expect(history.commitGuarded('undo', id)).toBe(false);
    expect(history.commitGuarded('redo', id)).toBe(false);
  });

  it('retains immutable record replay identities across undo and redo', () => {
    const history = new ContentHistory();
    const record = { sheetId: 'sheet', rowId: 'row' };
    history.recordModelRecord(record);
    record.rowId = 'changed';
    const retrieved = history.peekUndo()!;
    retrieved.record!.rowId = 'changed-again';

    history.commitUndo();
    expect(history.peekRedo()).toMatchObject({ kind: 'model-record', record: { sheetId: 'sheet', rowId: 'row' } });
    history.commitRedo();
    expect(history.peekUndo()?.record?.rowId).toBe('row');
  });

  it('clears history when a record identity cannot fit the history budget', () => {
    const history = new ContentHistory();
    history.record([write(null, 'first')], affected);
    history.recordModelRecord({ sheetId: 'sheet', rowId: 'x'.repeat(CONTENT_HISTORY_MAX_BYTES) });
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('keeps immutable content transitions and clears redo after an effective edit', () => {
    const history = new ContentHistory();
    const writes = [write(null, 'first')];
    history.record(writes, affected);
    writes[0]!.afterRaw = 'mutated';
    history.commitUndo();

    expect(history.canUndo).toBe(false);
    expect(history.peekRedo()?.writes[0]?.afterRaw).toBe('first');

    history.record([write('first', 'second')], affected);
    expect(history.canRedo).toBe(false);
    expect(history.peekUndo()?.writes[0]?.afterRaw).toBe('second');
  });

  it('does not let a retrieved transaction alter its retained replay data', () => {
    const history = new ContentHistory();
    history.record([write(null, 'first')], affected);

    const retrieved = history.peekUndo()!;
    retrieved.writes[0]!.afterRaw = 'mutated';
    retrieved.affected.cells[0]!.cell.rowId = 'other-row';

    expect(history.peekUndo()).toMatchObject({
      writes: [write(null, 'first')],
      affected,
    });
    history.commitUndo();
    expect(history.peekRedo()).toMatchObject({ writes: [write(null, 'first')], affected });
    history.commitRedo();
    expect(history.peekUndo()).toMatchObject({ writes: [write(null, 'first')], affected });
  });

  it('leaves empty undo and redo stacks unchanged when commits have no transaction', () => {
    const history = new ContentHistory();

    history.commitUndo();
    history.commitRedo();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('evicts the oldest entries by count and does not retain oversized entries', () => {
    const history = new ContentHistory();
    for (let index = 0; index <= CONTENT_HISTORY_MAX_ENTRIES; index += 1) {
      history.record([write(String(index), String(index + 1))], affected);
    }
    for (let index = 0; index < CONTENT_HISTORY_MAX_ENTRIES; index += 1) history.commitUndo();
    expect(history.canUndo).toBe(false);

    history.record([write(null, 'x'.repeat(CONTENT_HISTORY_MAX_BYTES))], affected);
    expect(history.canUndo).toBe(false);
  });

  it('rejects oversized order history without changing either stack', () => {
    const history = new ContentHistory();
    history.record([write(null, 'first')], affected);
    history.record([write('first', 'second')], affected);
    history.commitUndo();
    const undo = history.peekUndo();
    const redo = history.peekRedo();

    expect(history.recordOrder({ sheetId: 's', axis: 'row', before: ['x'.repeat(CONTENT_HISTORY_MAX_BYTES)], after: [] }))
      .toEqual({ ok: false, reason: 'order-history-too-large' });
    expect(history.peekUndo()).toEqual(undo);
    expect(history.peekRedo()).toEqual(redo);
  });

  it('evicts oldest mixed entries when retained order bytes exceed the shared budget', () => {
    const history = new ContentHistory();
    history.record([write(null, 'oldest')], affected);
    const first = 'a'.repeat(17000);
    const second = 'b'.repeat(17000);
    expect(history.recordOrder({ sheetId: 's', axis: 'row', before: [first], after: [first] })).toEqual({ ok: true });
    history.record([write(null, 'newer')], affected);
    expect(history.recordOrder({ sheetId: 's', axis: 'column', before: [second], after: [second] })).toEqual({ ok: true });

    expect(history.peekUndo()?.order?.axis).toBe('column');
    history.commitUndo();
    expect(history.peekUndo()?.writes[0]?.afterRaw).toBe('newer');
    history.commitUndo();
    expect(history.canUndo).toBe(false);
  });

  it('copies retained order snapshots and invalidates redo for a new order', () => {
    const history = new ContentHistory();
    history.record([write(null, 'first')], affected);
    history.commitUndo();
    const order = { sheetId: 's', axis: 'row' as const, before: ['a', 'b'], after: ['b', 'a'] };
    expect(history.recordOrder(order)).toEqual({ ok: true });
    order.after[0] = 'changed';
    expect(history.canRedo).toBe(false);
    const snapshot = history.peekUndo()!;
    expect(snapshot.order?.after).toEqual(['b', 'a']);
    (snapshot.order!.before as string[])[0] = 'changed';
    expect(history.peekUndo()?.order?.before).toEqual(['a', 'b']);
  });
});
