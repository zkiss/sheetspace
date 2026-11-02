import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSurface } from '@workspace/WorkspaceSurface';
import { useWorkspaceController } from '@workspace/useWorkspaceController';
import { useWorkspaceNavigationHistory } from './useWorkspaceNavigationHistory';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); delete (document as unknown as { timeline?: unknown }).timeline; });

it('samples before cancelling a history restore and rejects its delayed grid and viewport acknowledgements', () => {
  vi.useFakeTimers();
  vi.stubGlobal('KeyframeEffect', class {});
  Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1000 } });
  const animation = { cancel: vi.fn(), currentTime: 40, effect: null, onfinish: null as (() => void) | null };
  const selection = { anchor: { sheetId: 'sheet', rowIndex: 0, columnIndex: 0 }, extent: { sheetId: 'sheet', rowIndex: 0, columnIndex: 0 }, mode: 'cell' } as never;
  let controller: ReturnType<typeof useWorkspaceController>;
  let history: ReturnType<typeof useWorkspaceNavigationHistory>;
  function Harness() {
    controller = useWorkspaceController({ onBeforeUserMovement: () => history.cancelNavigationRestore(), onCreateSheet: vi.fn(), onClearSelection: vi.fn() });
    history = useWorkspaceNavigationHistory({ stageDestination: true, onRestoreSelection: () => true, onUnavailableTarget: vi.fn(), restoreViewport: controller.restoreViewport, selection, viewport: controller.viewport });
    return <WorkspaceSurface hasSheets isPanningWorkspace={controller.isPanningWorkspace}
      navigationMotion={controller.navigationMotion} onContextMenu={controller.handleWorkspaceContextMenu}
      viewport={controller.viewport} workspacePlaneRef={controller.workspacePlaneRef}
      workspaceSurfaceRef={controller.workspaceSurfaceRef}>{null}</WorkspaceSurface>;
  }
  render(<Harness />);
  const plane = screen.getByTestId('workspace-plane');
  Object.defineProperty(plane, 'animate', { configurable: true, value: () => animation });
  Object.defineProperty(plane, 'getAnimations', { configurable: true, value: () => [animation] });
  const grid = document.createElement('div');
  grid.scrollLeft = 240;
  grid.scrollTop = 360;
  act(() => history.registerScrollContainer('sheet', grid));
  act(() => { history.history.recordUserMovement(); vi.advanceTimersByTime(2000); });
  act(() => controller.commitFrozenViewport({ x: 500, y: 300, scale: 2 }));
  grid.scrollLeft = 700;
  act(() => { history.history.recordUserMovement(); vi.advanceTimersByTime(2000); });
  act(() => { history.history.traverse('back'); });
  expect(history!.historyRestoreForSheet('sheet')).toBeUndefined();
  expect(history!.navigationRestoreForSheet('sheet')).toBeUndefined();
  const staleFinish = animation.onfinish!;
  animation.cancel.mockClear();
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = original(element);
    if (element === plane) {
      expect(animation.cancel).not.toHaveBeenCalled();
      Object.defineProperty(style, 'transform', { configurable: true, value: 'matrix(1.5, 0, 0, 1.5, 123, 45)' });
    }
    return style;
  });
  act(() => { controller.freezeDisplayedViewport(); });
  expect(controller!.viewport).toEqual({ x: 123, y: 45, scale: 1.5 });
  expect(history!.historyRestoreForSheet('sheet')).toBeUndefined();
  expect(history!.navigationRestoreForSheet('sheet')).toBeUndefined();
  expect(history!.pendingNavigationSheetId).toBeUndefined();
  act(() => { history.acknowledgeGridRestore('sheet', 1); staleFinish(); vi.runAllTimers(); });
  expect(grid.scrollLeft).toBe(700);
  expect(controller!.viewport).toEqual({ x: 123, y: 45, scale: 1.5 });
  expect(history!.navigationRestoreForSheet('sheet')).toBeUndefined();
});
