import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMaximiseRuntime } from '@workspace/useMaximiseRuntime';
import { createNavigationTransport } from './navigationTransport';

const frame = { position: { x: 100, y: 200 }, size: { width: 400, height: 300 }, visualScale: 1 };
const size = { width: 800, height: 600 };
const rect = { left: 1, top: 2, right: 3, bottom: 4 };
const callbacks = () => ({ onSettled: vi.fn(), onFailure: vi.fn() });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const handoff = { freezeDisplayedViewport: () => ({ x: 0, y: 0, scale: 1 }), commitFrozenViewport: vi.fn() };
  const hook = renderHook(({ reduced, dimensions }) => useMaximiseRuntime(handoff, dimensions, reduced, () => true), { initialProps: { reduced: true, dimensions: size } });
  act(() => hook.result.current.enter('source', frame));
  hook.rerender({ reduced: false, dimensions: size });
  const controller = { navigateToTarget: vi.fn((_target, options) => { options.onSettled(); return () => {}; }), restoreViewport: vi.fn(() => () => {}) };
  const transport = createNavigationTransport(hook.result.current, controller, () => true, () => ({ saved: frame, displayed: frame }));
  return { hook, handoff, transport, tick: () => act(() => tick(performance.now() + 1000)) };
}

it('cancels the real restore transition without committing its viewport', async () => {
  const { hook, handoff, transport, tick } = setup();
  const result = callbacks();
  act(() => { transport.target('target', rect, {}, result); });
  expect(hook.result.current.currentState().mode).toBe('restoring');
  act(() => transport.cancel());
  tick();
  await act(flush);
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
  expect(hook.result.current.currentState().mode).toBe('canvas');
  expect(result.onFailure).toHaveBeenCalledWith('cancelled');
  expect(result.onSettled).not.toHaveBeenCalled();
});

it.each(['cancel', 'unavailable', 'unmount'] as const)('retires target entry on %s', async (reason) => {
  const { hook, transport, tick } = setup();
  const result = callbacks();
  let available = true;
  const bridge = createNavigationTransport(hook.result.current, { navigateToTarget: (_target, options) => { options.onSettled(); return () => {}; }, restoreViewport: () => () => {} }, () => available, () => ({ saved: frame, displayed: frame }));
  act(() => { bridge.target('target', rect, {}, result); });
  tick();
  await act(flush);
  expect(hook.result.current.currentState().mode).toBe('entering');
  act(() => {
    if (reason === 'cancel') bridge.cancel();
    else if (reason === 'unavailable') { available = false; bridge.reconcile(); }
    else bridge.deactivate();
  });
  tick();
  await act(flush);
  expect(hook.result.current.currentState().mode).toBe('canvas');
  expect(result.onSettled).not.toHaveBeenCalled();
  if (reason !== 'unmount') expect(result.onFailure).toHaveBeenCalledWith(reason === 'cancel' ? 'cancelled' : 'unavailable');
  transport.deactivate();
});

it('does not let an old presentation claim cancel a newer transition', () => {
  const { hook, transport, tick } = setup();
  act(() => { transport.target('target', rect, {}, callbacks()); });
  act(() => { hook.result.current.toggle(); });
  expect(hook.result.current.currentState().mode).toBe('entering');
  act(() => transport.cancel());
  tick();
  expect(hook.result.current.currentState().mode).toBe('maximised');
  expect(hook.result.current.currentState().sheetId).toBe('source');
});

it('retains cancellation ownership when a restore is retargeted by resizing', async () => {
  const { hook, handoff, transport, tick } = setup();
  act(() => { transport.target('target', rect, {}, callbacks()); });
  hook.rerender({ reduced: false, dimensions: { width: 1000, height: 700 } });
  act(() => transport.cancel());
  tick();
  await act(flush);
  expect(handoff.commitFrozenViewport).not.toHaveBeenCalled();
  expect(hook.result.current.currentState().mode).toBe('canvas');
});
