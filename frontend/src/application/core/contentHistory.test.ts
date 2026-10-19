import { describe, expect, it } from 'vitest';
import { CONTENT_HISTORY_MAX_BYTES, CONTENT_HISTORY_MAX_ENTRIES, ContentHistory } from './contentHistory';
import type { CellPersistenceWrite } from './userActions';

const affected = { sheetIds: ['sheet'], cells: [{ sheetId: 'sheet', cell: { rowId: 'row', columnId: 'column' } }] };
const write = (beforeRaw: string | null, afterRaw: string | null): CellPersistenceWrite => ({
  sheetId: 'sheet', rowId: 'row', columnId: 'column', beforeRaw, afterRaw,
});

describe('ContentHistory', () => {
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
});
