import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { autosaveClient } from '@test-support/apiClients';
import { measuredElementGeometry } from '@test-support/domGeometry';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { zoomWorkspace } from '@test-support/workspaceActions';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(target: HTMLElement, type: string, x: number, ctrlKey = false) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: x, ctrlKey });
  Object.assign(event, { pointerId: 17 });
  fireEvent(target, event);
}

type FrameGeometry = { left: number; top: number; width: number; height: number };

function transformScale(element: HTMLElement) {
  return Number(element.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1);
}

function surfaceFrameGeometry(element: HTMLElement, surface: HTMLElement): FrameGeometry {
  const viewport = {
    x: Number(surface.dataset.viewportX),
    y: Number(surface.dataset.viewportY),
    scale: Number(surface.dataset.viewportScale),
  };
  const scale = transformScale(element);
  return {
    left: viewport.x + Number.parseFloat(element.style.left) * viewport.scale,
    top: viewport.y + Number.parseFloat(element.style.top) * viewport.scale,
    width: Number.parseFloat(element.style.width) * scale * viewport.scale,
    height: Number.parseFloat(element.style.height) * scale * viewport.scale,
  };
}

function expectGeometry(actual: FrameGeometry, expected: FrameGeometry) {
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 6);
  }
}

function midpoint(from: FrameGeometry, to: FrameGeometry): FrameGeometry {
  const mix = (start: number, end: number) => start + (end - start) / 2;
  return {
    left: mix(from.left, to.left),
    top: mix(from.top, to.top),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}

it.each(['drag', 'resize', 'scale'] as const)('retires captured frame %s before maximising', (owner) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const api = autosaveClient({ updateSheetVisualScale: vi.fn() });
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 }, zIndex: 7 });
  render(<App apiClient={api} initialWorkbook={workbookWithSheets([sheet])} />);
  measuredElementGeometry(screen.getByTestId('workspace-surface'), { width: 800, height: 600 });
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  const target = owner === 'drag' ? within(frame).getByTestId('sheet-frame-header')
    : within(frame).getByRole('separator', { name: `Resize sheet Inputs from ${owner === 'resize' ? 'left' : 'right'}` });
  let captured = false;
  target.setPointerCapture = vi.fn(() => { captured = true; });
  target.hasPointerCapture = vi.fn(() => captured);
  target.releasePointerCapture = vi.fn(() => { captured = false; });
  pointer(target, 'pointerdown', 50, owner === 'scale');
  pointer(target, 'pointermove', 100, owner === 'scale');
  expect(captured).toBe(true);

  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  expect(target.releasePointerCapture).toHaveBeenCalledWith(17);
  pointer(target, 'pointermove', 150, owner === 'scale');
  pointer(target, 'pointerup', 150, owner === 'scale');
  pointer(target, 'pointerdown', 50, owner === 'scale');
  pointer(target, 'pointermove', 150, owner === 'scale');
  pointer(target, 'pointerup', 150, owner === 'scale');
  expect(captured).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));

  expect(frame).toHaveAttribute('data-position-x', '48');
  expect(frame).toHaveAttribute('data-position-y', '96');
  expect(frame).toHaveAttribute('data-frame-width', '310');
  expect(frame).toHaveAttribute('data-frame-height', '220');
  expect(frame).toHaveAttribute('data-visual-scale', '0.8');
  expect(frame).toHaveAttribute('data-z-index', '7');
  expect(api.updateSheetPosition).not.toHaveBeenCalled();
  expect(api.updateSheetFrameLayout).not.toHaveBeenCalled();
  expect(api.updateSheetVisualScale).not.toHaveBeenCalled();
});

it.each((['drag', 'resize', 'scale'] as const).flatMap((owner) => [
  { owner, reverseEarly: true },
  { owner, reverseEarly: false },
]))('moves the live $owner preview continuously and restores it (early reversal: $reverseEarly)', ({ owner, reverseEarly }) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const api = autosaveClient({ updateSheetVisualScale: vi.fn() });
  const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 48, y: 96 }, visualScale: 0.8, frameSize: { width: 310, height: 220 }, zIndex: 7 });
  render(<App apiClient={api} initialWorkbook={workbookWithSheets([sheet])} />);
  const surface = screen.getByTestId('workspace-surface');
  measuredElementGeometry(surface, { width: 800, height: 600 });
  vi.useFakeTimers();
  zoomWorkspace('in');
  act(() => vi.advanceTimersByTime(200));
  vi.useRealTimers();
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  fireEvent.click(within(frame).getByRole('cell', { name: 'Inputs A1 empty cell' }));
  const target = owner === 'drag' ? within(frame).getByTestId('sheet-frame-header')
    : within(frame).getByRole('separator', { name: `Resize sheet Inputs from ${owner === 'resize' ? 'left' : 'right'}` });
  let captured = false;
  target.setPointerCapture = vi.fn(() => { captured = true; });
  target.hasPointerCapture = vi.fn(() => captured);
  target.releasePointerCapture = vi.fn(() => { captured = false; });
  pointer(target, 'pointerdown', 50, owner === 'scale');
  pointer(target, 'pointermove', 100, owner === 'scale');
  expect(captured).toBe(true);

  const source = surfaceFrameGeometry(frame, surface);
  const sourceTableScale = transformScale(frame) * Number(surface.dataset.viewportScale);
  const viewport = { x: Number(surface.dataset.viewportX), y: Number(surface.dataset.viewportY), scale: Number(surface.dataset.viewportScale) };
  const savedGeometry = { left: viewport.x + 48 * viewport.scale, top: viewport.y + 96 * viewport.scale, width: 248 * viewport.scale, height: 176 * viewport.scale };
  const saved = ['48', '96', '310', '220', '0.8'];
  // A retained saved state would start the motion at the persisted bounds, not the live preview.
  expect(Math.abs(source.left - savedGeometry.left) + Math.abs(source.top - savedGeometry.top)
    + Math.abs(source.width - savedGeometry.width) + Math.abs(source.height - savedGeometry.height)).toBeGreaterThan(1);

  let now = 1_000;
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  function advance(ms: number) {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) act(() => callback(now));
  }

  fireEvent.click(document.querySelector<HTMLButtonElement>('.sheet-frame-active .sheet-frame-maximise')!, { detail: 1 });
  expect(frame).toHaveAttribute('data-presented', 'true');
  expect(target.releasePointerCapture).toHaveBeenCalledWith(17);
  expect(captured).toBe(false);
  pointer(target, 'lostpointercapture', 100, owner === 'scale');
  pointer(target, 'pointermove', 150, owner === 'scale');
  pointer(target, 'pointerup', 150, owner === 'scale');
  expect(captured).toBe(false);
  expect([frame.dataset.positionX, frame.dataset.positionY, frame.dataset.frameWidth, frame.dataset.frameHeight, frame.dataset.visualScale]).toEqual(saved);
  expectGeometry(surfaceFrameGeometry(frame, surface), source);
  const body = within(frame).getByTestId('sheet-frame-body');
  expect(transformScale(body)).toBeCloseTo(sourceTableScale, 6);
  expectGeometry({ left: source.left + parseFloat(body.style.left), top: source.top + parseFloat(body.style.top), width: parseFloat(body.style.width) * sourceTableScale, height: parseFloat(body.style.height) * sourceTableScale }, { left: source.left + sourceTableScale, top: source.top + 33 * sourceTableScale, width: source.width - 2 * sourceTableScale, height: source.height - 34 * sourceTableScale });

  advance(237.5);
  expectGeometry(surfaceFrameGeometry(frame, surface), midpoint(source, { left: 0, top: 0, width: 800, height: 600 }));
  expect(within(frame).getByTestId('sheet-frame-header')).toHaveStyle({ opacity: '0.5' });

  if (!reverseEarly) {
    advance(237.5);
    expectGeometry(surfaceFrameGeometry(frame, surface), { left: 0, top: 0, width: 800, height: 600 });
    expect(within(frame).getByTestId('sheet-frame-header')).toHaveStyle({ height: '0px', opacity: '0' });
  }
  const interrupted = surfaceFrameGeometry(frame, surface);
  const interruptedBodyScale = transformScale(body);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to workspace' }));
  expect(frame).toHaveAttribute('data-presented', 'true');
  expectGeometry(surfaceFrameGeometry(frame, surface), interrupted);
  expect(transformScale(body)).toBeCloseTo(interruptedBodyScale, 6);
  expect([frame.dataset.positionX, frame.dataset.positionY, frame.dataset.frameWidth, frame.dataset.frameHeight, frame.dataset.visualScale]).toEqual(saved);

  advance(237.5);
  expectGeometry(surfaceFrameGeometry(frame, surface), midpoint(interrupted, { left: 245, top: 190, width: 310, height: 220 }));
  advance(237.5);

  expect(frame).not.toHaveAttribute('data-presented');
  expect(screen.getByRole('article', { name: 'Sheet Inputs' })).toBe(frame);
  expect([frame.dataset.positionX, frame.dataset.positionY, frame.dataset.frameWidth, frame.dataset.frameHeight, frame.dataset.visualScale]).toEqual(saved);
  expect(frame).toHaveAttribute('data-z-index', '7');
  expectGeometry(surfaceFrameGeometry(frame, surface), { left: 245, top: 190, width: 310, height: 220 });
  expect(transformScale(frame) * Number(surface.dataset.viewportScale)).toBeCloseTo(1, 6);
  expect(api.updateSheetPosition).not.toHaveBeenCalled();
  expect(api.updateSheetFrameLayout).not.toHaveBeenCalled();
  expect(api.updateSheetVisualScale).not.toHaveBeenCalled();
});
