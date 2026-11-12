import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deletionFixture, endpointContents } from '@test-support/recordDeletionFixture';
import { useWorkbookController } from './useWorkbookController';

describe('local model record deletion', () => {
  it.each([false, true])('restores exact endpoints without an API when sorting is %s', async (sorting) => {
    const { initial, rowId } = deletionFixture(sorting);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial }));
    await act(async () => {
      expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true);
    });
    const deleted = endpointContents(result.current.workbook);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(initial));
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    expect(endpointContents(result.current.workbook)).toEqual(deleted);
  });
});
