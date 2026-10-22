import { useCallback, useRef } from 'react';
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
  const applyPendingScroll = useCallback((sheetId: string) => {
    const offset = pendingScroll.current.get(sheetId);
    const element = scrollContainers.current.get(sheetId);
    if (!offset || !element) return;
    element.scrollLeft = Math.min(Math.max(0, offset.left), Math.max(0, element.scrollWidth - element.clientWidth));
    element.scrollTop = Math.min(Math.max(0, offset.top), Math.max(0, element.scrollHeight - element.clientHeight));
    pendingScroll.current.delete(sheetId);
  }, []);
  const registerScrollContainer = useCallback((sheetId: string, element: HTMLElement | null) => {
    if (!element) {
      scrollContainers.current.delete(sheetId);
      return;
    }
    scrollContainers.current.set(sheetId, element);
    applyPendingScroll(sheetId);
  }, [applyPendingScroll]);
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
    window.requestAnimationFrame(() => [...pendingScroll.current.keys()].forEach(applyPendingScroll));
  }, [applyPendingScroll, onRestoreSelection, onUnavailableTarget, restoreViewport]);
  return { history: useNavigationHistory({ capture, restore }), registerScrollContainer };
}
