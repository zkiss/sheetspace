import { useCallback, useEffect, useRef } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onRestoreSelection, onUnavailableTarget, restoreViewport, selection, viewport }: {
  onRestoreSelection: (selection: CellSelection | null) => boolean;
  onUnavailableTarget: () => void;
  restoreViewport: (viewport: WorkspaceViewport) => void;
  selection: CellSelection | null;
  viewport: WorkspaceViewport;
}) {
  const scrollContainers = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef(new Map<string, { left: number; top: number }>());
  const pendingScrollFrames = useRef(new Map<string, number>());
  const applyPendingScroll = useCallback((sheetId: string) => {
    const offset = pendingScroll.current.get(sheetId);
    const element = scrollContainers.current.get(sheetId);
    if (!offset || !element) return;
    element.scrollLeft = Math.min(Math.max(0, offset.left), Math.max(0, element.scrollWidth - element.clientWidth));
    element.scrollTop = Math.min(Math.max(0, offset.top), Math.max(0, element.scrollHeight - element.clientHeight));
    pendingScroll.current.delete(sheetId);
  }, []);
  const applyPendingScrollAfterGridEffects = useCallback((sheetId: string) => {
    const previousFrame = pendingScrollFrames.current.get(sheetId);
    if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame);
    const frame = window.requestAnimationFrame(() => {
      pendingScrollFrames.current.delete(sheetId);
      applyPendingScroll(sheetId);
    });
    pendingScrollFrames.current.set(sheetId, frame);
  }, [applyPendingScroll]);
  useEffect(() => () => {
    pendingScrollFrames.current.forEach((frame) => window.cancelAnimationFrame(frame));
    pendingScrollFrames.current.clear();
  }, []);
  const registerScrollContainer = useCallback((sheetId: string, element: HTMLElement | null) => {
    if (!element) {
      scrollContainers.current.delete(sheetId);
      return;
    }
    scrollContainers.current.set(sheetId, element);
    // SheetGrid reveals an active selection from an effect after mounting. Apply
    // history scroll after that effect so selection restoration cannot replace it.
    if (pendingScroll.current.has(sheetId)) applyPendingScrollAfterGridEffects(sheetId);
  }, [applyPendingScrollAfterGridEffects]);
  const capture = useCallback(() => ({
    viewport,
    selection,
    scroll: Object.fromEntries([...scrollContainers.current].map(([sheetId, element]) => [sheetId, {
      left: element.scrollLeft, top: element.scrollTop,
    }])),
  }), [selection, viewport]);
  const restore = useCallback((context: ReturnType<typeof capture>) => {
    restoreViewport(context.viewport);
    if (!onRestoreSelection(context.selection) && context.selection) onUnavailableTarget();
    Object.entries(context.scroll).forEach(([sheetId, offset]) => pendingScroll.current.set(sheetId, offset));
    Object.keys(context.scroll).forEach(applyPendingScrollAfterGridEffects);
  }, [applyPendingScrollAfterGridEffects, onRestoreSelection, onUnavailableTarget, restoreViewport]);
  return { history: useNavigationHistory({ capture, restore }), registerScrollContainer };
}
