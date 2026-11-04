import { describe, expect, it, vi } from 'vitest';
import { ContentHistory } from '@application/core/contentHistory';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { shiftAxis } from '@workbook/mutations/reorderAxis';
import { createAxisReorder } from './axisReorder';

describe('axis order replay', () => {
  it('retains undo and redo on owned-order conflicts and recovers', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 2 });
    const [a, b, c] = sheet.content.rows;
    const current = { current: workbookWithSheets([sheet]) };
    const history = new ContentHistory();
    const enqueue = vi.fn();
    const feedback = vi.fn();
    const reorder = createAxisReorder({ current, history, enqueue, setWorkbook: vi.fn(), hasPending: () => false,
      admissionLocks: { current: new Set() }, setMutationFailure: vi.fn(), setContentHistoryFeedback: vi.fn(),
      publishHistory: vi.fn(), setReplayFailure: feedback });
    reorder.reorder('s', 'row', (workbook) => shiftAxis(workbook, 's', 'row', [a!], 1));
    const order = history.peekUndo()!.order!;
    const setRows = (rows: string[]) => {
      const document = current.current.documents.s!;
      current.current = { ...current.current, documents: { ...current.current.documents, s: { ...document, content: { ...document.content, rows } } } };
    };
    setRows([c!, b!, a!]);
    reorder.replay(order, 'undo');
    expect(feedback).toHaveBeenLastCalledWith('order-conflict');
    expect(history.canUndo).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    setRows([b!, a!, c!]);
    reorder.replay(order, 'undo');
    expect(feedback).toHaveBeenLastCalledWith(undefined);
    expect(current.current.documents.s!.content.rows).toEqual([a, b, c]);
    setRows([c!, b!, a!]);
    reorder.replay(order, 'redo');
    expect(feedback).toHaveBeenLastCalledWith('order-conflict');
    expect(history.canRedo).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
    setRows([a!, b!, c!]);
    reorder.replay(order, 'redo');
    expect(feedback).toHaveBeenLastCalledWith(undefined);
    expect(current.current.documents.s!.content.rows).toEqual([b, a, c]);
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('blocks pending replay and clears stale feedback on the next admission', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const current = { current: workbookWithSheets([sheet]) };
    const history = new ContentHistory();
    const feedback = vi.fn();
    const mutationFailure = vi.fn();
    const enqueue = vi.fn();
    let pending = false;
    const reorder = createAxisReorder({ current, history, enqueue, setWorkbook: vi.fn(), hasPending: () => pending,
      admissionLocks: { current: new Set() }, setMutationFailure: mutationFailure, setContentHistoryFeedback: vi.fn(),
      publishHistory: vi.fn(), setReplayFailure: feedback });
    reorder.reorder('s', 'row', (workbook) => shiftAxis(workbook, 's', 'row', [sheet.content.rows[0]!], 1));
    pending = true;
    reorder.replay(history.peekUndo()!.order!, 'undo');
    expect(feedback).toHaveBeenLastCalledWith('pending-model-transition');
    expect(history.canUndo).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    reorder.reorder('s', 'row', () => { throw new Error('must not transform'); });
    expect(feedback).toHaveBeenLastCalledWith(undefined);
    expect(mutationFailure).toHaveBeenLastCalledWith('pending-model-transition');
    pending = false;
    reorder.reorder('s', 'row', (workbook) => shiftAxis(workbook, 's', 'row', [sheet.content.rows[0]!], 1));
    expect(mutationFailure).toHaveBeenLastCalledWith(undefined);
    reorder.replay(history.peekUndo()!.order!, 'undo');
    expect(feedback).toHaveBeenLastCalledWith(undefined);
    expect(history.canRedo).toBe(true);
  });
});
