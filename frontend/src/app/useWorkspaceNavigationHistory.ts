import { useCallback, useRef } from 'react';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { useNavigationHistory } from '@reference-navigation/useNavigationHistory';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export function useWorkspaceNavigationHistory({ onSelectCell, restoreViewport, selection, viewport }: {
  onSelectCell: (target: NonNullable<CellSelection>['anchor']) => void;
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
    if (context.selection) onSelectCell(context.selection.anchor);
    window.requestAnimationFrame(() => Object.entries(context.scroll).forEach(([sheetId, offset]) => {
      const element = scrollContainers.current.get(sheetId);
      if (element) { element.scrollLeft = Math.max(0, offset.left); element.scrollTop = Math.max(0, offset.top); }
    }));
  }, [onSelectCell, restoreViewport]);
  return { history: useNavigationHistory({ capture, restore }), scrollContainers };
}
