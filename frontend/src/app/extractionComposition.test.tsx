import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { testRect } from '@test-support/domGeometry';
import { EXTRACTION_HANDOFF_DURATION } from './useExtractionHandoff';
import { SURFACE_SIZE, SOURCE_SCROLL, SOURCE_ID, TARGET_ID, PEER_ID, shiftTargetCells,
  framesInZOrder, frameElement, cellElement, cellText, renderComposition, mountAndMeasure } from '@test-support/extractionCompositionFixture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live SheetFrame/SheetGrid extraction composition — publication and readiness', () => {
  it.each(['rows', 'columns'] as const)('keeps the snapshot visible until the target paints the %s extraction', (mode) => {
    const selection: [string, string] = mode === 'rows' ? ['A2', 'A3'] : ['A1', 'B1'];
    const result = mountAndMeasure(renderComposition());
    const { surface, api, spies } = result;

    act(() => api().publish(mode, selection[0], selection[1]));

    // Snapshot keeps its own text and axes while the committed source is compacted.
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    expect(cellText(surface, SOURCE_ID, 'A2')).toBe('two');
    expect(getComputedStyle(cellElement(surface, SOURCE_ID, 'A2')).opacity).not.toBe('0');
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] .sheet-frame-body [role="rowheader"]`)).toHaveLength(6);
    // The waiting target is mounted but cannot mask the snapshot.
    const target = frameElement(surface, TARGET_ID);
    expect(target).toHaveClass('sheet-frame-extraction-handoff');
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    const waitingZIndex = Number(target.style.zIndex);
    expect(Number.isInteger(waitingZIndex)).toBe(true);
    expect(waitingZIndex).toBeLessThan(Number(frameElement(surface, SOURCE_ID).style.zIndex));
    // The committed target paints the extracted content.
    expect(cellText(surface, TARGET_ID, mode === 'rows' ? 'A1' : 'A2')).toBe('two');
    // Source interaction is suppressed while the snapshot owns presentation;
    // the target stays interactive.
    fireEvent.click(cellElement(surface, SOURCE_ID, 'A2'));
    expect(spies.select).not.toHaveBeenCalled();
    fireEvent.click(cellElement(surface, TARGET_ID, 'A1'));
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.select.mock.calls[0]?.[0]).toMatchObject({ sheetId: TARGET_ID });

    // Aligned, opaque target fragments transfer ownership to the real observer/owner.
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    expect(target).toHaveClass('sheet-frame-extraction-ready');
    expect(Number(target.style.zIndex)).toBeGreaterThan(waitingZIndex);
    // The snapshot survives readiness intact; the retirement grace is still pending.
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    expect(frameElement(surface, SOURCE_ID).querySelectorAll('[role="rowheader"]')).toHaveLength(6);
    // Ownership grace does not restyle the captured scroll.
    expect(surface.querySelector<HTMLElement>(`[data-sheet-id="${SOURCE_ID}"] .sheet-frame-body`)?.scrollTop).toBe(SOURCE_SCROLL.top);
  });

  it('forces an overview source to detail while its snapshot is owned', () => {
    const result = mountAndMeasure(renderComposition({ viewportScale: 0.01 }));
    const { surface, api } = result;
    expect(frameElement(surface, SOURCE_ID)).toHaveAttribute('data-rendering-mode', 'overview');
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('.sheet-frame-body')) return testRect({ left: 101, top: 133, width: 418, height: 246 });
      if (this.matches('.sheet-grid-corner')) return testRect({ left: 101, top: 133, width: 40, height: 26 });
      return originalRect.call(this);
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(418);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(418);
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(246);
    act(() => api().publish('rows', 'A2', 'A3'));
    expect(frameElement(surface, SOURCE_ID)).toHaveAttribute('data-rendering-mode', 'detailed');
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    rect.mockRestore(); width.mockRestore(); clientWidth.mockRestore(); clientHeight.mockRestore();
  });

  it('does not let a misaligned waiting target mask the snapshot or take chrome ownership', () => {
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => {
      result.remock();
      shiftTargetCells(surface, 8);
    });
    act(() => api().bumpGeometryRevision());

    const target = frameElement(surface, TARGET_ID);
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    expect(Number.isInteger(Number(target.style.zIndex))).toBe(true);
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    expect(framesInZOrder(surface).indexOf(PEER_ID)).toBeLessThan(framesInZOrder(surface).indexOf(SOURCE_ID));

    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    expect(target).toHaveClass('sheet-frame-extraction-ready');
  });

  it('does not let a target missing a required fragment mask the snapshot', () => {
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    cellElement(surface, TARGET_ID, 'A1').remove();
    act(() => api().bumpGeometryRevision());

    const target = frameElement(surface, TARGET_ID);
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
  });

  it('does not let wrong target text mask the snapshot, and accepts it once corrected', async () => {
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    const targetCell = cellElement(surface, TARGET_ID, 'A1');
    await act(async () => { targetCell.textContent = 'wrong'; });

    const target = frameElement(surface, TARGET_ID);
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    expect(cellText(surface, SOURCE_ID, 'A2')).toBe('two');

    await act(async () => { targetCell.textContent = 'two'; });
    expect(target).toHaveClass('sheet-frame-extraction-ready');
  });

  it('preserves the unrelated peer relative order from publication through readiness', () => {
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;
    const orderBefore = framesInZOrder(surface);
    expect(orderBefore.indexOf(PEER_ID)).toBeLessThan(orderBefore.indexOf(SOURCE_ID));

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());

    const orderAfter = framesInZOrder(surface);
    expect(orderAfter.indexOf(PEER_ID)).toBeLessThan(orderAfter.indexOf(SOURCE_ID));
    expect(orderAfter.indexOf(SOURCE_ID)).toBeLessThan(orderAfter.indexOf(TARGET_ID));
    for (const id of [PEER_ID, SOURCE_ID, TARGET_ID]) {
      expect(Number.isInteger(Number(frameElement(surface, id).style.zIndex))).toBe(true);
    }
  });

  it('clears the waiting presentation when the accepted completion rolls back', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const onFeedback = vi.fn();
    const result = mountAndMeasure(renderComposition({
      apiClient: autosaveClient({ saveModelLifecycle: save }),
      onFeedback,
    }));
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    expect(surface.querySelector(`[data-sheet-id="${TARGET_ID}"]`)).not.toBeNull();

    await waitFor(() => expect(surface.querySelector(`[data-sheet-id="${TARGET_ID}"]`)).toBeNull());
    expect(onFeedback).toHaveBeenCalledWith(expect.stringContaining('persistence-failed'));
    // The source is restored with its original rows and the captured formula display.
    expect(cellText(surface, SOURCE_ID, 'A2')).toBe('two');
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] .sheet-frame-body [role="rowheader"]`)).toHaveLength(6);
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
  });
});

describe('live SheetFrame/SheetGrid extraction composition — retirement and nonvisual exits', () => {
  it.each(['rows', 'columns'] as const)('hands the %s extraction to the live compacted source after retirement', (mode) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const selection: [string, string] = mode === 'rows' ? ['A2', 'A3'] : ['A1', 'B1'];
    const result = mountAndMeasure(renderComposition());
    const { surface, api, spies } = result;

    act(() => api().publish(mode, selection[0], selection[1]));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    expect(frameElement(surface, TARGET_ID)).toHaveClass('sheet-frame-extraction-ready');

    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));

    // Recovery to ordinary frames and interaction with no handoff residue.
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    const source = frameElement(surface, SOURCE_ID);
    const rowHeaders = (frame: HTMLElement) => [...frame.querySelectorAll('[role="rowheader"]')].map((node) => node.textContent);
    const columnHeaders = (frame: HTMLElement) => [...frame.querySelectorAll('[role="columnheader"]')].map((node) => node.textContent);
    if (mode === 'rows') {
      expect(rowHeaders(source)).toEqual(['1', '2', '3', '4']);
      expect(cellText(surface, TARGET_ID, 'A1')).toBe('two');
      expect(cellText(surface, TARGET_ID, 'A2')).toBe('three');
    } else {
      expect(columnHeaders(source)).toEqual(['', 'A', 'B']);
    }
    expect(mode === 'rows' ? cellText(surface, SOURCE_ID, 'A2') : cellText(surface, TARGET_ID, 'A4')).toBe('42');
    // The captured scroll survives the retirement.
    expect(source.querySelector<HTMLElement>('.sheet-frame-body')?.scrollTop).toBe(SOURCE_SCROLL.top);
    // Ordinary interaction returns on both sides of the handoff.
    spies.select.mockClear();
    fireEvent.click(cellElement(surface, TARGET_ID, 'A1'));
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.select.mock.calls[0]?.[0]).toMatchObject({ sheetId: TARGET_ID });
    fireEvent.click(cellElement(surface, SOURCE_ID, 'A1'));
    expect(spies.select).toHaveBeenCalledTimes(2);
    expect(spies.select.mock.calls[1]?.[0]).toMatchObject({ sheetId: SOURCE_ID });
  });

  it('restores snapshot ownership when coverage is lost during the fade and retires only after a fresh ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    const target = frameElement(surface, TARGET_ID);
    expect(target).toHaveClass('sheet-frame-extraction-ready');

    act(() => vi.advanceTimersByTime(100));
    const fadingCell = cellElement(surface, TARGET_ID, 'A1');
    await act(async () => { fadingCell.textContent = 'wrong'; });

    // The snapshot protects the content again and the fade is abandoned.
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    expect(cellText(surface, SOURCE_ID, 'A4')).toBe('42');
    act(() => vi.advanceTimersByTime(1000));
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] [role="rowheader"]`)).toHaveLength(6);

    await act(async () => { fadingCell.textContent = 'two'; });
    expect(target).toHaveClass('sheet-frame-extraction-ready');
    // The pre-loss deadline does not retire the snapshot; the fresh ready restarts it.
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION - 1));
    expect(target).toHaveClass('sheet-frame-extraction-ready');
    act(() => vi.advanceTimersByTime(1));
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] [role="rowheader"]`)).toHaveLength(4);
  });

  it('rechecks target axis geometry changed during the fade without a geometry revision', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;
    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    const target = frameElement(surface, TARGET_ID);
    const cell = cellElement(surface, TARGET_ID, 'A1');
    const header = target.querySelector<HTMLElement>('[role="columnheader"]:not(.sheet-grid-corner)')!;
    const alignedRect = cell.getBoundingClientRect.bind(cell);
    cell.getBoundingClientRect = () => {
      const rect = alignedRect();
      return testRect({ left: rect.left, top: rect.top, width: rect.width + (header.style.width === '200px' ? 8 : 0), height: rect.height });
    };
    expect(target).toHaveClass('sheet-frame-extraction-ready');
    act(() => vi.advanceTimersByTime(100));

    await act(async () => { header.style.width = '200px'; });
    expect(target).not.toHaveClass('sheet-frame-extraction-ready');
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(cellText(surface, SOURCE_ID, 'A2')).toBe('two');

    await act(async () => { header.style.width = ''; });
    expect(target).toHaveClass('sheet-frame-extraction-ready');
    act(() => vi.advanceTimersByTime(EXTRACTION_HANDOFF_DURATION));
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
  });

  it('discards a waiting handoff when the extraction is undone before readiness', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => api().controller.commands.undo());

    expect(surface.querySelector(`[data-sheet-id="${TARGET_ID}"]`)).toBeNull();
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] [role="rowheader"]`)).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a fading handoff when the extraction is undone after readiness', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    expect(frameElement(surface, TARGET_ID)).toHaveClass('sheet-frame-extraction-ready');

    act(() => api().controller.commands.undo());

    expect(surface.querySelector(`[data-sheet-id="${TARGET_ID}"]`)).toBeNull();
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the handoff at a known-empty exit without reviving it when the surface returns', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    surface.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 0, height: 0 });
    act(() => fireEvent.scroll(surface));

    // The authorized nonvisual exit: snapshot retired, target keeps ordinary presentation.
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    expect(surface.querySelectorAll(`[data-sheet-id="${SOURCE_ID}"] [role="rowheader"]`)).toHaveLength(4);
    expect(frameElement(surface, TARGET_ID)).toBeInTheDocument();

    surface.getBoundingClientRect = () => testRect({ left: 0, top: 0, ...SURFACE_SIZE });
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    act(() => vi.advanceTimersByTime(1000));
    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
  });

  it('ends an active fade when reduced motion is preferred', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let listener: (() => void) | undefined;
    const preference = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => preference);
    const result = mountAndMeasure(renderComposition());
    const { surface, api } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    act(() => { result.remock(); });
    act(() => api().bumpGeometryRevision());
    expect(frameElement(surface, TARGET_ID)).toHaveClass('sheet-frame-extraction-ready');

    preference.matches = true;
    act(() => listener?.());

    expect(surface.querySelector('.sheet-frame-extraction-handoff')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pending', 'fading'] as const)('cleans up timers and state when unmounted while %s', (phase) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = mountAndMeasure(renderComposition());
    const { surface, api, unmount } = result;

    act(() => api().publish('rows', 'A2', 'A3'));
    if (phase === 'fading') {
      act(() => { result.remock(); });
      act(() => api().bumpGeometryRevision());
      expect(frameElement(surface, TARGET_ID)).toHaveClass('sheet-frame-extraction-ready');
    }

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
