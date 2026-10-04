import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { resizeTargetIds, useAxisResize } from './useAxisResize';
import { AXIS_SIZE_LIMITS } from '@workbook/core/axisSizePolicy';
import { tabularProjection } from '@workbook/read/queries';
import { sheetDocument } from '@test-support/workbookFactories';

function event(element: HTMLElement, overrides: Partial<PointerEvent<HTMLElement>> = {}) {
  return {
    button: 0,
    clientX: 10,
    clientY: 10,
    currentTarget: element,
    pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as PointerEvent<HTMLElement>;
}

const source = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 100, columnCount: 100 });
const sheet = tabularProjection(source);
const row = source.content.rows[0]!;
const column = source.content.columns[0]!;
afterEach(() => { document.body.replaceChildren(); });

function selected(axis: 'row' | 'column', start: number, end: number, sheetId = sheet.id) {
  return { mode: axis === 'row' ? 'rows' : 'columns', anchor: { sheetId, cell: { rowId: sheet.rows[start]!, columnId: sheet.columns[start]! } },
    extent: { sheetId, cell: { rowId: sheet.rows[end]!, columnId: sheet.columns[end]! } } } as const;
}
function mountedHandle(width = 76, height = 26.4) {
  const header = document.createElement('div'), handle = document.createElement('div');
  header.append(handle); document.body.append(header);
  header.getBoundingClientRect = vi.fn(() => ({ bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON: () => undefined }));
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = vi.fn().mockReturnValue(false);
  return handle;
}

describe('resizeTargetIds', () => {
  it.each(['row', 'column'] as const)('selects matching and reversed selected %ss, including offscreen stable IDs', (axis) => {
    const ids = axis === 'row' ? sheet.rows : sheet.columns;
    expect(resizeTargetIds(sheet, axis, ids[90]!, selected(axis, 5, 90))).toEqual(ids.slice(5, 91));
    expect(resizeTargetIds(sheet, axis, ids[5]!, selected(axis, 90, 5))).toEqual(ids.slice(5, 91));
  });
  it.each(['row', 'column'] as const)('falls back to only the target for stale, cross-sheet, opposite-axis, or outside selections', (axis) => {
    const id = (axis === 'row' ? sheet.rows : sheet.columns)[1]!;
    expect(resizeTargetIds(sheet, axis, id, selected(axis, 3, 5))).toEqual([id]);
    expect(resizeTargetIds(sheet, axis, id, selected(axis, 0, 2, 'other'))).toEqual([id]);
    expect(resizeTargetIds(sheet, axis, id, selected(axis === 'row' ? 'column' : 'row', 0, 2))).toEqual([id]);
    expect(resizeTargetIds(sheet, axis, id, { ...selected(axis, 0, 2), anchor: { sheetId: sheet.id, cell: { rowId: 'gone', columnId: 'gone' } } } as never)).toEqual([id]);
    expect(resizeTargetIds(sheet, axis, 'missing')).toEqual([]);
  });
  it.each(['row', 'column'] as const)('falls back to only the target for cells-mode selections', (axis) => {
    const ids = axis === 'row' ? sheet.rows : sheet.columns;
    const cells = { mode: 'cells', anchor: { sheetId: sheet.id, cell: { rowId: sheet.rows[0]!, columnId: sheet.columns[0]! } },
      extent: { sheetId: sheet.id, cell: { rowId: sheet.rows[2]!, columnId: sheet.columns[2]! } } } as const;
    expect(resizeTargetIds(sheet, axis, ids[1]!, cells)).toEqual([ids[1]]);
  });
  it.each(['row', 'column'] as const)('falls back when either selected %s endpoint is foreign or unknown', (axis) => {
    const ids = axis === 'row' ? sheet.rows : sheet.columns;
    const range = selected(axis, 0, 2);
    const foreignAnchor = { ...range, anchor: { ...range.anchor, sheetId: 'other' } };
    const foreignExtent = { ...range, extent: { ...range.extent, sheetId: 'other' } };
    const unknownAnchor = { ...range, anchor: { ...range.anchor, cell: { rowId: 'gone', columnId: 'gone' } } };
    const unknownExtent = { ...range, extent: { ...range.extent, cell: { rowId: 'gone', columnId: 'gone' } } };
    for (const selection of [foreignAnchor, foreignExtent, unknownAnchor, unknownExtent]) {
      expect(resizeTargetIds(sheet, axis, ids[1]!, selection as never)).toEqual([ids[1]]);
    }
  });
});

describe('useAxisResize sessions', () => {
  it.each([{ axis: 'column' as const, scale: .5, delta: 40 }, { axis: 'column' as const, scale: 2, delta: 40 }, { axis: 'row' as const, scale: .5, delta: 20 }, { axis: 'row' as const, scale: 2, delta: 20 }])
  ('converts $axis movement at scale $scale and clamps both boundaries', ({ axis, scale, delta }) => {
    const commit = vi.fn(), handle = mountedHandle(76 * scale, 26.4 * scale);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    const id = axis === 'row' ? row : column, initial = axis === 'row' ? 26.4 : 76;
    act(() => { result.current.start(event(handle, { clientX: 10, clientY: 10 }), axis, id, initial); result.current.stop(event(handle, { clientX: axis === 'row' ? 10 : 10 + delta * scale, clientY: axis === 'row' ? 10 + delta * scale : 10 })); });
    expect(commit).toHaveBeenCalledWith([{ axis, axisId: id, size: initial + delta }]);
    act(() => { result.current.start(event(handle), axis, id, initial); result.current.stop(event(handle, { clientX: -10000, clientY: -10000 })); });
    expect(commit.mock.calls[1]![0][0].size).toBe(axis === 'row' ? 16 : 24);
    act(() => { result.current.start(event(handle), axis, id, initial); result.current.stop(event(handle, { clientX: 10000, clientY: 10000 })); });
    expect(commit.mock.calls[2]![0][0].size).toBe(AXIS_SIZE_LIMITS[axis].max);
  });

  it.each(['row', 'column'] as const)('uses scale 1 when rendered %s geometry is non-positive', (axis) => {
    const commit = vi.fn(), handle = mountedHandle(0, 0);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    const id = axis === 'row' ? row : column, initial = axis === 'row' ? 26.4 : 76;
    act(() => { result.current.start(event(handle), axis, id, initial); result.current.stop(event(handle, { clientX: axis === 'row' ? 10 : 50, clientY: axis === 'row' ? 50 : 10 })); });
    expect(commit).toHaveBeenCalledWith([{ axis, axisId: id, size: initial + 40 }]);
  });

  it.each(['row', 'column'] as const)('ignores non-finite %s movement without invalidating the active session', (axis) => {
    const commit = vi.fn(), handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    const id = axis === 'row' ? row : column, initial = axis === 'row' ? 26.4 : 76;
    act(() => { result.current.start(event(handle), axis, id, initial); result.current.move(event(handle, { clientX: axis === 'row' ? 10 : Number.NaN, clientY: axis === 'row' ? Number.NaN : 10 })); });
    expect(result.current.preview).toMatchObject({ axis, ids: [id], size: initial });
    act(() => { result.current.stop(event(handle, { clientX: axis === 'row' ? 10 : 50, clientY: axis === 'row' ? 50 : 10 })); });
    expect(commit).toHaveBeenCalledWith([{ axis, axisId: id, size: initial + 40 }]);
  });

  it('commits selected offscreen IDs once', () => {
    const commit = vi.fn(), handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet, commit, selection: selected('column', 0, 90) }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.stop(event(handle, { clientX: 30 })); result.current.stop(event(handle, { clientX: 30 })); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![0]).toEqual(sheet.columns.slice(0, 91).map((axisId) => ({ axis: 'column', axisId, size: 96 })));
  });

  it.each([{ name: 'wrong button', id: column, button: 2 }, { name: 'unknown target', id: 'missing', button: 0 }])('rejects a $name start without capturing or creating a preview', ({ id, button }) => {
    const commit = vi.fn(), handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle, { button }), 'column', id, 76); result.current.stop(event(handle, { clientX: 40 })); });
    expect(result.current.preview).toBeNull();
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('preserves an owned moved preview for non-owning pointer events', () => {
    const commit = vi.fn(), handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.move(event(handle, { clientX: 30 })); });
    expect(result.current.preview).toMatchObject({ size: 96 });
    act(() => { result.current.move(event(handle, { pointerId: 2, clientX: 500 })); result.current.stop(event(handle, { pointerId: 2, clientX: 500 })); });
    expect(result.current.preview).toMatchObject({ size: 96 });
    expect(commit).not.toHaveBeenCalled();
    act(() => { result.current.stop(event(handle, { clientX: 30 })); });
    expect(commit).toHaveBeenCalledWith([{ axis: 'column', axisId: column, size: 96 }]);
  });

  it('rejects starts while interactions are disabled without capturing or committing', () => {
    const commit = vi.fn(), handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet, commit, interactionsEnabled: false }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.stop(event(handle, { clientX: 40 })); });
    expect(result.current.preview).toBeNull();
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects starts without a commit callback without capturing or creating a preview', () => {
    const handle = mountedHandle();
    const { result } = renderHook(() => useAxisResize({ sheet }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.stop(event(handle, { clientX: 40 })); });
    expect(result.current.preview).toBeNull();
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
  });

  it.each(['pointer cancel', 'lost capture', 'Escape', 'blur', 'unmount'] as const)('cancels without committing on %s', (interruption) => {
    const commit = vi.fn(), handle = mountedHandle();
    const hook = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { hook.result.current.start(event(handle), 'row', row, 26.4); hook.result.current.move(event(handle, { clientY: 60 })); });
    expect(hook.result.current.preview).toMatchObject({ axis: 'row', size: 76.4 });
    act(() => {
      if (interruption === 'pointer cancel' || interruption === 'lost capture') hook.result.current.interrupt(event(handle));
      else if (interruption === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (interruption === 'blur') window.dispatchEvent(new Event('blur'));
      else hook.unmount();
      hook.result.current.stop(event(handle, { clientY: 60 })); });
    if (interruption !== 'unmount') expect(hook.result.current.preview).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['selection', 'owner', 'active sheet', 'sheet', 'target IDs', 'disabled', 'removed commit'] as const)('cancels a stale session when %s changes', (change) => {
    const commit = vi.fn(), handle = mountedHandle(), owner = Symbol();
    const initialSelection = selected('column', 0, 2);
    type ResizeOptions = Parameters<typeof useAxisResize>[0];
    const initialProps: ResizeOptions = { sheet, commit, selection: initialSelection, selectionOwner: owner, activeSheetId: sheet.id, interactionsEnabled: true };
    const hook = renderHook((props: ResizeOptions) => useAxisResize(props), { initialProps });
    act(() => { hook.result.current.start(event(handle), 'column', column, 76); hook.result.current.move(event(handle, { clientX: 40 })); });
    expect(hook.result.current.preview).toMatchObject({ size: 106 });
    act(() => { hook.rerender({ sheet: change === 'sheet' ? { ...sheet, id: 'other' } : change === 'target IDs' ? { ...sheet, columns: sheet.columns.slice(1) } : sheet, commit: change === 'removed commit' ? undefined : commit, selection: change === 'selection' ? selected('row', 0, 2) : initialSelection, selectionOwner: change === 'owner' ? Symbol() : owner, activeSheetId: change === 'active sheet' ? 'other' : sheet.id, interactionsEnabled: change === 'disabled' ? false : true }); });
    expect(hook.result.current.preview).toBeNull();
    act(() => { hook.result.current.stop(event(handle, { clientX: 40 })); });
    expect(commit).not.toHaveBeenCalled();
  });

  it('releases connected ownership exactly once when a handle detaches', () => {
    const commit = vi.fn(), handle = mountedHandle(); handle.hasPointerCapture = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.detachHandle(handle); result.current.stop(event(handle, { clientX: 40 })); result.current.detachHandle(handle); });
    expect(handle.releasePointerCapture).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
  });

  it('does not detach a non-owning handle and clears a disconnected owner without committing', () => {
    const commit = vi.fn(), handle = mountedHandle(), other = mountedHandle(); handle.hasPointerCapture = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.detachHandle(other); });
    expect(result.current.preview).not.toBeNull();
    handle.remove();
    act(() => { result.current.move(event(handle, { clientX: 40 })); result.current.stop(event(handle, { clientX: 40 })); });
    expect(result.current.preview).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it('releases captured ownership once after a successful stop', () => {
    const commit = vi.fn(), handle = mountedHandle(); handle.hasPointerCapture = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.stop(event(handle, { clientX: 40 })); result.current.stop(event(handle, { clientX: 40 })); });
    expect(result.current.preview).toBeNull();
    expect(handle.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not commit or release twice when cancellation precedes a stale release', () => {
    const commit = vi.fn(), handle = mountedHandle(); handle.hasPointerCapture = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useAxisResize({ sheet, commit }));
    act(() => { result.current.start(event(handle), 'column', column, 76); result.current.interrupt(event(handle)); result.current.stop(event(handle, { clientX: 40 })); });
    expect(handle.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});
