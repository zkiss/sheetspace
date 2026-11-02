import { describe, expect, it, vi } from 'vitest';
import { createNavigationTransport } from './navigationTransport';

const frame = { position: { x: 1, y: 2 }, size: { width: 20, height: 10 }, visualScale: 1 };
const rect = { left: 1, top: 2, right: 3, bottom: 4 };
const viewport = { x: 2, y: 3, scale: 1 };
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function setup(mode: 'canvas' | 'maximised' | 'entering' = 'canvas') {
  let state: { mode: 'canvas' | 'maximised' | 'entering'; sheetId?: string } = { mode, sheetId: 'source' };
  const events: string[] = [];
  const runtime = {
    currentState: () => state,
    ensureCanvas: vi.fn(async () => { events.push('restore'); state = { mode: 'canvas' }; return 'settled' as const; }),
    ensureMaximised: vi.fn(async () => { events.push('ready'); return 'settled' as const; }),
    enter: vi.fn(() => { events.push('enter'); }),
  };
  const controller = {
    navigateToTarget: vi.fn<(target: typeof rect, options: { onSettled: () => void; onCancelled: () => void }) => ReturnType<typeof vi.fn>>(() => { events.push('move'); return vi.fn(); }),
    restoreViewport: vi.fn<(view: typeof viewport, settled: () => void, cancelled: () => void) => ReturnType<typeof vi.fn>>(() => { events.push('viewport'); return vi.fn(); }),
  };
  const available = vi.fn(() => true);
  const transport = createNavigationTransport(runtime, controller, available, () => ({ saved: frame, displayed: frame }));
  const callbacks = { onSettled: vi.fn(), onFailure: vi.fn() };
  return { runtime, controller, available, transport, callbacks, events };
}

describe('navigation transport', () => {
  it('starts canvas motion synchronously and preserves options until delayed settlement', () => {
    const { transport, controller, callbacks } = setup();
    transport.target('target', rect, { minimumScale: 2 }, callbacks);
    expect(controller.navigateToTarget).toHaveBeenCalledWith(rect, expect.objectContaining({ minimumScale: 2 }));
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  });

  it('retains staged policy through canvas, moves, enters and reports final readiness', async () => {
    const { transport, controller, callbacks, events, runtime } = setup('maximised');
    expect(transport.stageDestination()).toBe(true);
    transport.target('target', rect, {}, callbacks);
    await flush();
    expect(transport.stageDestination()).toBe(false);
    expect(events).toEqual(['restore', 'move']);
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    await flush();
    expect(events).toEqual(['restore', 'move', 'enter', 'ready']);
    expect(runtime.enter).toHaveBeenCalledWith('target', frame, frame, true);
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  });

  it('bypasses motion for the same entering sheet', async () => {
    const { transport, controller, callbacks } = setup('entering');
    transport.restore('source', viewport, callbacks);
    await flush();
    expect(controller.restoreViewport).not.toHaveBeenCalled();
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  });

  it('captures independent target and viewport motion and retires replaced callbacks', () => {
    const { transport, controller, callbacks } = setup();
    const next = { onSettled: vi.fn(), onFailure: vi.fn() };
    transport.target('first', rect, { forceOversized: true }, callbacks);
    transport.restore('empty', viewport, next);
    expect(controller.navigateToTarget.mock.results[0].value).toHaveBeenCalledOnce();
    expect(controller.restoreViewport).toHaveBeenCalledWith(viewport, expect.any(Function), expect.any(Function));
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    controller.restoreViewport.mock.calls[0][1]();
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    expect(next.onSettled).toHaveBeenCalledOnce();
  });

  it('retains content reveal options and skips already visible canvas destinations', () => {
    const { transport, controller, callbacks } = setup();
    transport.content('target', rect, false, callbacks);
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
    expect(controller.navigateToTarget).not.toHaveBeenCalled();
    transport.content('target', rect, true, callbacks);
    expect(controller.navigateToTarget).toHaveBeenCalledWith(rect, expect.objectContaining({ preserveVisibleAxes: true }));
  });

  it('translates controller cancellation and reports unavailable destinations', () => {
    const { transport, controller, callbacks, available } = setup();
    transport.target('target', rect, {}, callbacks);
    controller.navigateToTarget.mock.calls[0][1].onCancelled();
    expect(callbacks.onFailure).toHaveBeenCalledWith('cancelled');
    available.mockReturnValue(false);
    transport.target('missing', rect, {}, callbacks);
    expect(callbacks.onFailure).toHaveBeenCalledWith('unavailable');
  });

  it('retires pending work on unmount and ignores late callbacks', () => {
    const { transport, controller, callbacks } = setup();
    transport.target('target', rect, {}, callbacks);
    transport.deactivate();
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    expect(controller.navigateToTarget.mock.results[0].value).toHaveBeenCalledOnce();
  });

  it('moves to a content destination even inside bounds when transferring presentation', async () => {
    const { transport, controller, callbacks } = setup('maximised');
    transport.content('other', rect, false, callbacks);
    await flush();
    expect(controller.navigateToTarget).toHaveBeenCalledWith(rect, expect.objectContaining({ preserveVisibleAxes: true }));
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    await flush();
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
  });

  it('reports removal once and ignores a later motion callback', () => {
    const { transport, controller, callbacks, available } = setup();
    transport.restore('empty', viewport, callbacks);
    expect(transport.activeDestination()).toBe('empty');
    available.mockReturnValue(false);
    transport.reconcile();
    controller.restoreViewport.mock.calls[0][1]();
    expect(callbacks.onFailure).toHaveBeenCalledWith('unavailable');
    expect(callbacks.onSettled).not.toHaveBeenCalled();
    expect(transport.activeDestination()).toBeUndefined();
  });

  it('keeps a reentrant successor when a predecessor is released', () => {
    const { transport, controller, callbacks } = setup();
    const successor = { onSettled: vi.fn(), onFailure: vi.fn() };
    controller.navigateToTarget.mockImplementationOnce(() => vi.fn(() => {
      transport.restore('successor', viewport, successor);
    }));
    transport.target('old', rect, {}, callbacks);
    transport.target('replaced', rect, {}, callbacks);
    expect(transport.activeDestination()).toBe('successor');
    expect(controller.navigateToTarget).toHaveBeenCalledTimes(1);
    controller.restoreViewport.mock.calls[0][1]();
    expect(successor.onSettled).toHaveBeenCalledOnce();
  });

  it('ignores semantic settlement after explicit cancellation', async () => {
    const { transport, runtime, callbacks, controller } = setup('maximised');
    let settle!: (result: 'settled') => void;
    runtime.ensureCanvas.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    const cancel = transport.target('other', rect, {}, callbacks);
    cancel();
    settle('settled');
    await flush();
    expect(callbacks.onFailure).toHaveBeenCalledWith('cancelled');
    expect(controller.navigateToTarget).not.toHaveBeenCalled();
  });

  it('translates staged controller cancellation without entering the destination', async () => {
    const { transport, controller, runtime, callbacks } = setup('maximised');
    transport.target('other', rect, { naturalScale: 2 }, callbacks);
    await flush();
    controller.navigateToTarget.mock.calls[0][1].onCancelled();
    await flush();
    expect(callbacks.onFailure).toHaveBeenCalledWith('cancelled');
    expect(runtime.enter).not.toHaveBeenCalled();
  });

  it('keeps each staged motion bound to its original target and options', async () => {
    const { transport, controller, runtime, callbacks } = setup('maximised');
    let settle!: (result: 'settled') => void;
    runtime.ensureCanvas.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    transport.target('old', rect, { forceOversized: true }, callbacks);
    const nextRect = { ...rect, left: 100 };
    transport.target('next', nextRect, { minimumScale: 3 }, callbacks);
    settle('settled');
    await flush();
    expect(controller.navigateToTarget).toHaveBeenCalledTimes(1);
    expect(controller.navigateToTarget).toHaveBeenCalledWith(nextRect, expect.objectContaining({ minimumScale: 3 }));
  });

  it('preserves synchronous canvas settlement and safely ignores an old cancellation handle', () => {
    const { transport, controller, callbacks } = setup();
    controller.navigateToTarget.mockImplementationOnce((_target, options) => {
      options.onSettled();
      return vi.fn();
    });
    const old = transport.target('one', rect, {}, callbacks);
    expect(callbacks.onSettled).toHaveBeenCalledOnce();
    transport.restore('two', viewport, callbacks);
    old();
    expect(transport.activeDestination()).toBe('two');
  });

  it('does not start an old semantic wait after entry starts a successor', async () => {
    const { transport, controller, runtime, callbacks } = setup('maximised');
    runtime.enter.mockImplementationOnce(() => { transport.restore('new', viewport, callbacks); });
    transport.target('old', rect, {}, callbacks);
    await flush();
    controller.navigateToTarget.mock.calls[0][1].onSettled();
    await flush();
    expect(runtime.ensureMaximised).not.toHaveBeenCalled();
    expect(transport.activeDestination()).toBe('new');
  });
});
