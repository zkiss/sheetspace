import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { useExtractionPaintCoverage } from './useExtractionPaintCoverage';
import { EXTRACTION_HANDOFF_DURATION, useExtractionHandoff } from './useExtractionHandoff';

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
  it.each([
    ['pending', 'workspace'], ['fading', 'workspace'],
    ['pending', 'body'], ['fading', 'body'],
  ] as const)('ends a %s handoff when the %s is hidden without reviving it', (phase, hidden) => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.append(root);
    let clip = bounds(0, 0, 300, 300);
    root.getBoundingClientRect = () => clip;
    const sourceFrame = frame(root, 'source');
    let bodyBounds = bounds(0, 0, 300, 300);
    sourceFrame.querySelector('.sheet-frame-body')!.getBoundingClientRect = () => bodyBounds;
    const target = frame(root, 'target');
    if (phase === 'pending') target.querySelector('[data-cell-key]')!.textContent = 'wrong';
    const source = sheetDocument({ id: 'source', name: 'Source' });
    const range = { start: { rowIndex: 0, columnIndex: 0 }, end: { rowIndex: 0, columnIndex: 0 } };
    const ref = { current: root };
    const { result, rerender, unmount } = renderHook(({ revision }) => {
      const owner = useExtractionHandoff(['source', 'target']);
      const operation = owner.handoff && { ...owner.handoff, range };
      useExtractionPaintCoverage(ref, operation, owner.targetReady, owner.targetNotReady, owner.cancel, revision, owner.registerCoverage);
      return owner;
    }, { initialProps: { revision: 0 } });
    act(() => { const token = result.current.begin(source, 'target'); result.current.accepted(token); });
    expect(result.current.handoff?.ready).toBe(phase === 'fading');
    if (hidden === 'workspace') { clip = bounds(0, 0, 0, 0); root.style.display = 'none'; }
    else { bodyBounds = bounds(0, 0, 0, 0); sourceFrame.querySelector<HTMLElement>('.sheet-frame-body')!.style.display = 'none'; }
    rerender({ revision: 1 });
    expect(result.current.handoff).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    clip = bounds(0, 0, 300, 300);
    bodyBounds = bounds(0, 0, 300, 300);
    rerender({ revision: 2 });
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(result.current.handoff).toBeNull();
    unmount();
    root.remove();
    vi.useRealTimers();
  });

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
