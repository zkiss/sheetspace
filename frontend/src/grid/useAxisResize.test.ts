import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { resizeTargetIds, useAxisResize } from './useAxisResize';
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

describe('useAxisResize boundaries', () => {
  it('rejects unknown targets and cancels invalid or superseded pointer work', () => {
    const sheet = tabularProjection(sheetDocument({ id: 'sheet', name: 'Sheet' }));
    expect(resizeTargetIds(sheet, 'row', 'missing')).toEqual([]);

    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAxisResize({ sheet, commit: enabled ? commit : undefined }),
      { initialProps: { enabled: true } },
    );
    const header = document.createElement('div');
    const handle = document.createElement('div');
    header.append(handle);
    document.body.append(header);
    header.getBoundingClientRect = vi.fn(() => ({
      bottom: 20, height: 20, left: 0, right: 100, top: 0, width: 100, x: 0, y: 0,
      toJSON: () => undefined,
    }));
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn().mockReturnValue(false);

    act(() => {
      result.current.start(event(handle, { button: 2 }), 'row', sheet.rows[0]!, 20);
      result.current.start(event(handle), 'row', 'missing', 20);
      result.current.start(event(handle), 'row', sheet.rows[0]!, 20);
      result.current.move(event(handle, { pointerId: 2 }));
      result.current.move(event(handle, { clientY: Number.POSITIVE_INFINITY }));
    });
    expect(result.current.preview).not.toBeNull();

    rerender({ enabled: false });
    act(() => result.current.move(event(handle)));
    expect(result.current.preview).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    header.remove();
  });
});
