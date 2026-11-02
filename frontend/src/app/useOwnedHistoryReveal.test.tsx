import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { ContentHistoryFeedback } from '@application/react/useWorkbookController';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';
import { useOwnedHistoryReveal } from './useOwnedHistoryReveal';

function setup(staged = true, strict = false, initial = false, replaceDuringReplay = false) {
  const sheet = sheetDocument({ id: 'history', name: 'History' });
  const feedback = (identity: string): ContentHistoryFeedback => ({ identity,
    affected: { sheetIds: [sheet.id], cells: [] }, before: [],
    after: [{ sheetId: sheet.id, ...cellIdentityAt(sheet.content, 'A1')!, raw: null, display: null }],
  });
  const inputs = { feedback: undefined as ContentHistoryFeedback | undefined, editing: false,
    sheets: [sheet], creatingAxes: {}, stageDestination: () => staged,
    controller: { workspaceSurfaceSize: { width: 1000, height: 1000 } as { width: number; height: number } | null,
      workspaceSurfaceRef: { current: document.createElement('div') }, viewport: { x: 0, y: 0, scale: 1 }, navigateToTarget: vi.fn() },
  };
  if (initial) inputs.feedback = feedback('one');
  const requests: { onSettled: () => void; onFailure: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const onPresentedCell = vi.fn();
  let navigation: ReturnType<typeof useWorkspaceNavigationHistory>;
  let newestCurrent = () => false;
  const reveal = vi.fn((_destination, callbacks: { onSettled: () => void; onFailure: () => void }) => {
    const request = { ...callbacks, cancel: vi.fn() };
    if (replaceDuringReplay) request.cancel.mockImplementation(() => navigation.history.explicitNavigation((operation) => { newestCurrent = operation.isCurrent; }));
    requests.push(request);
    return request.cancel;
  });
  const view = renderHook(() => {
    navigation = useWorkspaceNavigationHistory({ onRestoreSelection: () => true, onUnavailableTarget: vi.fn(),
      restoreViewport: (_viewport, settled) => { settled(); return () => {}; }, selection: null, viewport: inputs.controller.viewport });
    const delivery = useOwnedHistoryReveal({ ...inputs, acquire: navigation.startContentNavigation, reveal, onPresentedCell });
    return { delivery, navigation };
  }, { wrapper: strict ? StrictMode : undefined });
  return { ...view, inputs, sheet, feedback, reveal, requests, onPresentedCell, newestCurrent: () => newestCurrent(), show: (identity = 'one') => {
    inputs.feedback = feedback(identity);
    view.rerender();
  } };
}

describe('owned content-history delivery', () => {
  it('publishes command selection once after visible acknowledgement, never after cancellation', () => {
    const state = setup();
    state.show();
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.onPresentedCell).not.toHaveBeenCalled();
    act(() => state.requests[0].onSettled());
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.onPresentedCell).toHaveBeenCalledTimes(1);
    expect(state.onPresentedCell).toHaveBeenCalledWith(state.feedback('one').after[0]);
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.onPresentedCell).toHaveBeenCalledTimes(1);
    state.show('two');
    const stale = state.result.current.delivery;
    act(() => state.result.current.navigation.recordUserGridMovement());
    act(() => { state.requests[1].onSettled(); stale.consume('history', 'two'); });
    expect(state.onPresentedCell).toHaveBeenCalledTimes(1);
  });
  it('admits canvas delivery eagerly without adding a navigation-history entry', () => {
    const state = setup(false);
    state.show();
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(true);
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
    expect(state.result.current.delivery.pending).toBe(false);
    act(() => state.requests[0].onSettled());
    expect(state.result.current.navigation.history.canGoBack).toBe(false);
    state.rerender();
    expect(state.reveal).toHaveBeenCalledOnce();
  });

  it('closes staged delivery through intermediate canvas and opens only after final settlement', () => {
    const state = setup();
    state.show();
    expect(state.result.current.delivery.ready).toBe(false);
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
    state.inputs.stageDestination = () => false;
    state.rerender();
    expect(state.result.current.delivery.ready).toBe(false);
    act(() => state.requests[0].onSettled());
    expect(state.result.current.delivery.ready).toBe(true);
    expect(state.result.current.delivery.canReveal('other', 'one')).toBe(false);
    expect(state.result.current.delivery.canReveal('history', 'obsolete')).toBe(false);
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(true);
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
  });

  it('retains the reveal payload after cosmetic expiry, without repeating consumption', () => {
    const state = setup();
    state.show();
    state.inputs.feedback = undefined;
    state.rerender();
    expect(state.result.current.delivery.pendingSheetId).toBe('history');
    act(() => state.requests[0].onSettled());
    expect(state.result.current.delivery.feedback?.identity).toBe('one');
    act(() => state.result.current.delivery.consume('history', 'one'));
    state.inputs.feedback = state.feedback('one');
    state.rerender();
    expect(state.reveal).toHaveBeenCalledOnce();
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
  });

  it.each(['movement', 'cancel', 'explicit', 'traversal'] as const)('retires ownership on %s, including the post-transport grid-ack gap', (replacement) => {
    const state = setup();
    if (replacement === 'traversal') {
      state.inputs.controller.viewport = { x: 200, y: 100, scale: 1 };
      state.rerender();
      act(() => state.result.current.navigation.history.explicitNavigation((operation) => operation.complete()));
    }
    state.show();
    act(() => state.requests[0].onSettled());
    const stale = state.result.current.delivery;
    act(() => {
      if (replacement === 'movement') state.result.current.navigation.recordUserGridMovement();
      if (replacement === 'cancel') state.result.current.navigation.cancelNavigationRestore();
      if (replacement === 'explicit') state.result.current.navigation.history.explicitNavigation(() => {});
      if (replacement === 'traversal') state.result.current.navigation.history.traverse('back');
    });
    act(() => { stale.consume('history', 'one'); state.requests[0].onSettled(); state.requests[0].onFailure(); });
    expect(stale.canReveal('history', 'one')).toBe(false);
    expect(state.result.current.delivery.feedback).toBeUndefined();
    state.rerender();
    expect(state.reveal).toHaveBeenCalledOnce();
  });

  it('replaces content and ignores predecessor success, failure, acknowledgement and cancellation', () => {
    const state = setup();
    state.show();
    const oldDelivery = state.result.current.delivery;
    state.show('two');
    expect(state.requests[0].cancel).toHaveBeenCalledOnce();
    act(() => { state.requests[0].onSettled(); state.requests[0].onFailure(); oldDelivery.consume('history', 'one'); });
    expect(state.requests[1].cancel).not.toHaveBeenCalled();
    expect(state.result.current.delivery.feedback?.identity).toBe('two');
    expect(state.result.current.delivery.ready).toBe(false);
    act(() => state.requests[1].onSettled());
    expect(state.result.current.delivery.canReveal('history', 'two')).toBe(true);
  });

  it('content acquisition retires a pending explicit destination without recording a jump', () => {
    const state = setup();
    const cancel = vi.fn();
    const retired = vi.fn();
    act(() => state.result.current.navigation.history.explicitNavigation((operation) => {
      state.result.current.navigation.startExplicitNavigation(operation,
        { kind: 'cell', target: { sheetId: state.sheet.id, cell: cellIdentityAt(state.sheet.content, 'A1')! } },
        () => cancel, undefined, retired);
    }));
    state.show();
    expect(cancel).toHaveBeenCalledOnce();
    expect(retired).toHaveBeenCalledOnce();
    expect(state.result.current.navigation.pendingNavigationSheetId).toBeUndefined();
    expect(state.result.current.navigation.history.canGoBack).toBe(false);
  });

  it('defers dispatch for editing or missing measurement and resumes valid ownership once', () => {
    const state = setup();
    state.inputs.editing = true;
    state.show();
    expect(state.reveal).not.toHaveBeenCalled();
    state.inputs.editing = false;
    state.inputs.controller.workspaceSurfaceSize = null;
    state.rerender();
    expect(state.reveal).not.toHaveBeenCalled();
    state.inputs.controller.workspaceSurfaceSize = { width: 1000, height: 1000 };
    state.rerender();
    expect(state.reveal).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'failure', 'unmount'] as const)('retires outstanding work on %s', (reason) => {
    const state = setup();
    state.show();
    const stale = state.result.current.delivery;
    if (reason === 'missing') { state.inputs.sheets = []; state.rerender(); }
    if (reason === 'failure') act(() => state.requests[0].onFailure());
    if (reason === 'unmount') state.unmount();
    act(() => state.requests[0].onSettled());
    expect(stale.canReveal('history', 'one')).toBe(false);
    expect(state.requests[0].cancel).toHaveBeenCalledOnce();
  });

  it('handles synchronous settlement before the cancellation handle returns', () => {
    const state = setup();
    state.reveal.mockImplementationOnce((_destination, callbacks) => { callbacks.onSettled(); return vi.fn(); });
    state.show();
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(true);
  });

  describe.each(['rows', 'columns'] as const)('deleted durable %s', (axis) => {
    it.each(['before dispatch', 'during transport', 'awaiting acknowledgement'] as const)('retires delivery %s and allows a successor', (phase) => {
      const state = setup();
      state.inputs.editing = phase === 'before dispatch';
      state.show();
      if (phase === 'awaiting acknowledgement') act(() => state.requests[0].onSettled());
      const stale = state.result.current.delivery;
      const predecessor = state.requests[0];

      state.inputs.sheets = [{ ...state.sheet, content: { ...state.sheet.content, [axis]: state.sheet.content[axis].slice(1) } }];
      state.inputs.feedback = undefined;
      state.inputs.controller.workspaceSurfaceSize = null;
      state.rerender();

      expect(state.result.current.delivery.pending).toBe(false);
      expect(state.result.current.delivery.pendingSheetId).toBeUndefined();
      expect(state.result.current.delivery.feedback).toBeUndefined();
      expect(stale.canReveal('history', 'one')).toBe(false);
      if (predecessor) expect(predecessor.cancel).toHaveBeenCalledTimes(phase === 'during transport' ? 1 : 0);
      else expect(state.reveal).not.toHaveBeenCalled();

      state.inputs.editing = false;
      state.inputs.controller.workspaceSurfaceSize = { width: 1000, height: 1000 };
      state.inputs.sheets = [state.sheet];
      state.rerender();
      expect(state.result.current.delivery.pending).toBe(false);
      state.show('two');
      const successor = state.requests[state.requests.length - 1];
      act(() => { predecessor?.onSettled(); predecessor?.onFailure(); stale.consume('history', 'one'); });
      expect(state.result.current.delivery.ready).toBe(false);
      expect(successor.cancel).not.toHaveBeenCalled();
      act(() => successor.onSettled());
      expect(state.result.current.delivery.canReveal('history', 'two')).toBe(true);
      act(() => state.result.current.delivery.consume('history', 'two'));
      expect(state.result.current.delivery.pending).toBe(false);
    });
  });

  it('accepts transport success once and ignores a later failure while awaiting grid acknowledgement', () => {
    const state = setup();
    state.show();
    act(() => { state.requests[0].onSettled(); state.requests[0].onFailure(); });
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(true);
    act(() => state.result.current.delivery.consume('history', 'one'));
    expect(state.result.current.delivery.pending).toBe(false);
  });

  it('ignores reentrant predecessor disposal after successor admission', () => {
    const state = setup();
    state.show();
    state.requests[0].cancel.mockImplementation(() => state.requests[0].onFailure());
    state.show('two');
    expect(state.result.current.delivery.feedback?.identity).toBe('two');
    act(() => state.requests[1].onSettled());
    expect(state.result.current.delivery.canReveal('history', 'two')).toBe(true);
  });

  it('supports effect replay without reopening a terminally consumed identity', () => {
    const state = setup(false, true);
    state.show();
    act(() => state.result.current.delivery.consume('history', 'one'));
    state.rerender();
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
    expect(state.reveal).toHaveBeenCalledOnce();
  });

  it.each(['explicit', 'content', 'traversal'] as const)('keeps reentrant %s newer than the replacing content request', (kind) => {
    const state = setup();
    state.inputs.controller.viewport = { x: 200, y: 100, scale: 1 };
    state.rerender();
    act(() => state.result.current.navigation.history.explicitNavigation((operation) => operation.complete()));
    state.show();
    const stale = state.result.current.delivery;
    let current = () => false;
    const retired = vi.fn();
    state.requests[0].cancel.mockImplementation(() => {
      if (kind === 'explicit') state.result.current.navigation.history.explicitNavigation((operation) => { current = operation.isCurrent; });
      if (kind === 'content') state.result.current.navigation.startContentNavigation((operation) => { current = operation.isCurrent; }, retired);
      if (kind === 'traversal') expect(state.result.current.navigation.history.traverse('back')).toBe(true);
    });

    state.show('two');
    act(() => { state.requests[0].onSettled(); state.requests[0].onFailure(); stale.consume('history', 'one'); });
    state.rerender();

    expect(state.reveal).toHaveBeenCalledOnce();
    expect(state.requests[0].cancel).toHaveBeenCalledOnce();
    expect(state.result.current.delivery.canReveal('history', 'two')).toBe(false);
    if (kind !== 'traversal') expect(current()).toBe(true);
    expect(retired).not.toHaveBeenCalled();
    state.show('three');
    expect(state.reveal).toHaveBeenCalledTimes(2);
  });

  it.each(['retirement', 'viewport'] as const)('does not release newer ownership from a second captured explicit %s disposer', (source) => {
    const state = setup();
    let current = () => false;
    const admit = () => state.result.current.navigation.startContentNavigation((operation) => { current = operation.isCurrent; }, vi.fn());
    const cancel = vi.fn(() => { if (source === 'viewport') admit(); });
    const retired = vi.fn(() => { if (source === 'retirement') admit(); });
    act(() => state.result.current.navigation.history.explicitNavigation((operation) => {
      state.result.current.navigation.startExplicitNavigation(operation,
        { kind: 'cell', target: { sheetId: state.sheet.id, cell: cellIdentityAt(state.sheet.content, 'A1')! } },
        () => cancel, undefined, retired);
    }));

    state.show();

    expect(current()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(retired).toHaveBeenCalledOnce();
    expect(state.reveal).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure', 'replacement'] as const)('handles synchronous %s before installing its returned handle', (outcome) => {
    const state = setup();
    const cancel = vi.fn();
    let current = () => false;
    state.reveal.mockImplementationOnce((_destination, callbacks) => {
      if (outcome === 'success') callbacks.onSettled();
      if (outcome === 'failure') callbacks.onFailure();
      if (outcome === 'replacement') state.result.current.navigation.history.explicitNavigation((operation) => { current = operation.isCurrent; });
      return cancel;
    });

    state.show();
    state.rerender();

    expect(cancel).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1);
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(outcome === 'success');
    if (outcome === 'replacement') expect(current()).toBe(true);
    expect(state.reveal).toHaveBeenCalledOnce();
  });

  it('replays initially admitted StrictMode work with fresh attempt guards and captured teardown', () => {
    const state = setup(true, true, true);
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].cancel).toHaveBeenCalledOnce();
    act(() => { state.requests[0].onSettled(); state.requests[0].onFailure(); });
    expect(state.result.current.delivery.ready).toBe(false);
    expect(state.requests[1].cancel).not.toHaveBeenCalled();
    act(() => state.requests[1].onSettled());
    const stale = state.result.current.delivery;
    act(() => stale.consume('history', 'one'));
    state.rerender();
    expect(state.requests).toHaveLength(2);
    state.unmount();
    expect(stale.canReveal('history', 'one')).toBe(false);
    expect(state.requests[1].cancel).not.toHaveBeenCalled();
  });

  it('does not replay a logical request superseded reentrantly during lifecycle disposal', () => {
    const state = setup(true, true, true, true);
    expect(state.requests).toHaveLength(1);
    expect(state.newestCurrent()).toBe(true);
    act(() => { state.requests[0].onSettled(); state.requests[0].onFailure(); });
    state.rerender();
    expect(state.newestCurrent()).toBe(true);
    expect(state.result.current.delivery.canReveal('history', 'one')).toBe(false);
    expect(state.requests[0].cancel).toHaveBeenCalledOnce();
  });
});
