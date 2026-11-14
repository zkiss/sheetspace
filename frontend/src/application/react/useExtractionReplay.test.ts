import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ContentHistory } from '@application/core/contentHistory';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useExtractionReplay } from './useExtractionReplay';

it('does not move a different history entry when an extraction settles late', () => {
  const workbook = workbookWithSheets([sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 })]);
  const history = new ContentHistory();
  history.recordExtraction(workbook, workbook);
  let settle = () => {};
  const publishHistory = vi.fn();
  const { result } = renderHook(() => useExtractionReplay({
    history, current: () => workbook, requireAuthority: false, hasPending: () => false, clearFeedback: vi.fn(), publishHistory,
    submit: (transform, success) => {
      const prepared = transform(workbook);
      settle = success;
      return { result: prepared, completion: Promise.resolve(prepared) };
    },
  }));
  act(() => result.current.replay(history.peekUndo()!, 'undo'));
  history.recordExtraction(workbook, workbook);
  const newer = history.peekUndo()!.identity;
  act(() => settle());
  expect(history.peekUndo()?.identity).toBe(newer);
  expect(history.canRedo).toBe(false);
  expect(publishHistory).not.toHaveBeenCalled();
});

it.each([undefined, 'not-a-uuid'])('rejects missing or malformed online authority without submitting (%s)', (authority) => {
  const workbook = workbookWithSheets([sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 })]);
  const history = new ContentHistory();
  history.recordExtraction(workbook, workbook, authority);
  const submit = vi.fn();
  const { result } = renderHook(() => useExtractionReplay({
    history, current: () => workbook, requireAuthority: true, hasPending: () => false,
    clearFeedback: vi.fn(), publishHistory: vi.fn(), submit,
  }));
  act(() => result.current.replay(history.peekUndo()!, 'undo'));
  expect(result.current.failure).toBe('missing-extraction-authority');
  expect(submit).not.toHaveBeenCalled();
  expect(history.canUndo).toBe(true);
  expect(history.canRedo).toBe(false);
});
