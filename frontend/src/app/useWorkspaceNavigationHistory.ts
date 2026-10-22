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
    window.requestAnimationFrame(() => Object.entries(context.scroll).forEach(([sheetId, offset]) => {
      const element = scrollContainers.current.get(sheetId);
      if (element) { element.scrollLeft = Math.max(0, offset.left); element.scrollTop = Math.max(0, offset.top); }
    }));
  }, [onRestoreSelection, onUnavailableTarget, restoreViewport]);
  return { history: useNavigationHistory({ capture, restore }), scrollContainers };
}
