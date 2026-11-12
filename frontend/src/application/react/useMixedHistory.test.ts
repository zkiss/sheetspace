import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContentHistory } from '@application/core/contentHistory';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { shiftAxis } from '@workbook/mutations/reorderAxis';
import { useMixedHistory } from './useMixedHistory';

describe('mixed history feedback', () => {
  it('clears an extraction replay failure when an order redo succeeds', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    const current = { current: workbook };
    const history = new ContentHistory();
    history.recordExtraction(workbook, workbook);
    let pending = false;
    const enqueue = vi.fn();
    const { result } = renderHook(() => useMixedHistory({
      current, history, setWorkbook: vi.fn(), enqueue, hasPending: () => pending,
      admissionLocks: { current: new Set() }, setMutationFailure: vi.fn(),
      setContentHistoryFeedback: vi.fn(), setCellFeedback: vi.fn(), publishHistory: vi.fn(),
      formulaResults: {} as FormulaEvaluationSnapshot, applyResult: vi.fn(), replayRecord: vi.fn(),
      submit: () => { throw new Error('unexpected submission'); },
    }));

    act(() => result.current.reorder('s', 'row', (source) => shiftAxis(source, 's', 'row', [sheet.content.rows[0]!], 1)));
    act(() => result.current.replay('undo'));
    expect(current.current.documents.s!.content.rows).toEqual(sheet.content.rows);
    pending = true;
    act(() => result.current.replay('undo'));
    expect(result.current.extractionFailure).toBe('pending-model-transition');
    expect(history.peekUndo()?.kind).toBe('extraction');
    expect(history.peekRedo()?.kind).toBe('axis-order');

    pending = false;
    act(() => result.current.replay('redo'));
    expect(current.current.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
    expect(result.current.extractionFailure).toBeUndefined();
    expect(history.peekUndo()?.kind).toBe('axis-order');
    expect(history.canRedo).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('retains failed replay feedback until a successful different action or reset', () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
    const workbook = workbookWithSheets([sheet]);
    const current = { current: workbook };
    const history = new ContentHistory();
    let pending = false;
    const { result, rerender } = renderHook(() => useMixedHistory({
      current, history, setWorkbook: vi.fn(), enqueue: vi.fn(), hasPending: () => pending,
      admissionLocks: { current: new Set() }, setMutationFailure: vi.fn(),
      setContentHistoryFeedback: vi.fn(), setCellFeedback: vi.fn(), publishHistory: vi.fn(),
      formulaResults: {} as FormulaEvaluationSnapshot, applyResult: vi.fn(), replayRecord: vi.fn(),
      submit: () => { throw new Error('unexpected submission'); },
    }));
    act(() => result.current.reorder('s', 'row', (source) => shiftAxis(source, 's', 'row', [sheet.content.rows[0]!], 1)));
    current.current = workbook;
    act(() => result.current.replay('undo'));
    expect(result.current.orderFailure).toBe('order-conflict');
    rerender();
    expect(result.current.orderFailure).toBe('order-conflict');
    act(() => result.current.clearFeedback());
    expect(result.current.orderFailure).toBeUndefined();
    history.clear();
    history.recordExtraction(workbook, workbook);
    pending = true;
    act(() => result.current.replay('undo'));
    expect(result.current.extractionFailure).toBe('pending-model-transition');
    pending = false;
    act(() => result.current.reorder('s', 'row', (source) => shiftAxis(source, 's', 'row', [sheet.content.rows[0]!], 1)));
    expect(result.current.extractionFailure).toBeUndefined();
  });
});
