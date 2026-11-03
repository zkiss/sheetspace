import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { useExtractionPaintCoverage } from './useExtractionPaintCoverage';

function bounds(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function frame(root: HTMLElement, id: string) {
  const frame = document.createElement('div');
  frame.dataset.workspaceSheetFrame = '';
  frame.dataset.sheetId = id;
  frame.innerHTML = '<div class="sheet-frame-body"><div class="sheet-grid-corner"></div><div data-cell-key="A1">value</div></div>';
  const body = frame.querySelector<HTMLElement>('.sheet-frame-body')!;
  body.getBoundingClientRect = () => bounds(0, 0, 300, 300);
  Object.defineProperty(body, 'offsetWidth', { value: 300 });
  frame.querySelector('.sheet-grid-corner')!.getBoundingClientRect = () => bounds(0, 0, 40, 26);
  frame.querySelector('[data-cell-key]')!.getBoundingClientRect = () => bounds(40, 26, 76, 26.4);
  root.append(frame);
  return frame;
}

describe('extraction paint observation', () => {
  it('rechecks coverage after geometry revisions, mutations and scrolling, then disposes listeners', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let clip = bounds(0, 0, 300, 300);
    root.getBoundingClientRect = () => clip;
    frame(root, 'source');
    const target = frame(root, 'target');
    const operation = { token: 1, source: sheetDocument({ id: 'source', name: 'Source' }), targetId: 'target',
      range: { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 0, columnIndex: 0 } }, ready: false };
    const ready = vi.fn(), waiting = vi.fn(), cancel = vi.fn();
    const ref = { current: root };
    const { rerender, unmount } = renderHook(({ revision }) =>
      useExtractionPaintCoverage(ref, operation, ready, waiting, cancel, revision), { initialProps: { revision: 0 } });
    expect(ready).toHaveBeenCalledWith(1);
    await act(async () => { target.querySelector('[data-cell-key]')!.textContent = 'wrong'; });
    expect(waiting).toHaveBeenCalledWith(1);
    await act(async () => { target.querySelector('[data-cell-key]')!.textContent = 'value'; });
    expect(ready).toHaveBeenCalledTimes(2);
    clip = bounds(400, 400, 100, 100);
    rerender({ revision: 1 });
    expect(cancel).toHaveBeenCalledWith(1);
    clip = bounds(0, 0, 300, 300);
    act(() => root.dispatchEvent(new Event('scroll')));
    expect(ready).toHaveBeenCalledTimes(3);
    unmount();
    act(() => root.dispatchEvent(new Event('scroll')));
    expect(ready).toHaveBeenCalledTimes(3);
    root.remove();
  });
});
