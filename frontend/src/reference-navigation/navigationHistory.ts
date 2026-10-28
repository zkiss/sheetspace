import type { CellSelection } from '@grid/cellInteractionContracts';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

export type NavigationContext = {
  viewport: WorkspaceViewport;
  selection: CellSelection | null;
  scroll: Readonly<Record<string, { left: number; top: number }>>;
};

export type NavigationHistory = { entries: readonly NavigationContext[]; cursor: number };

export const EMPTY_NAVIGATION_HISTORY: NavigationHistory = { entries: [], cursor: -1 };

export function sameNavigationContext(left: NavigationContext, right: NavigationContext) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function appendNavigationContext(history: NavigationHistory, context: NavigationContext): NavigationHistory {
  if (history.entries[history.cursor] && sameNavigationContext(history.entries[history.cursor]!, context)) return history;
  const entries = [...history.entries.slice(0, history.cursor + 1), context];
  return { entries, cursor: history.cursor + 1 };
}

export function traverseNavigationHistory(history: NavigationHistory, direction: 'back' | 'forward') {
  const cursor = history.cursor + (direction === 'back' ? -1 : 1);
  return cursor < 0 || cursor >= history.entries.length
    ? undefined
    : { history: { ...history, cursor }, context: history.entries[cursor]! };
}
