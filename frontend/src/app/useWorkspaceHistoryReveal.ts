import { useEffect, useRef } from 'react';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { ContentHistoryFeedback } from '@application/react/useWorkbookController';
import type { SheetDocument } from '@workbook/core/model';
import { historyRevealTarget } from './historyRevealTarget';
import { workspaceViewportBounds } from '@workspace/workspaceGeometry';

export type HistoryRevealController = {
  workspaceSurfaceSize: { width: number; height: number } | null;
  workspaceSurfaceRef: React.RefObject<HTMLElement>;
  viewport: Parameters<typeof workspaceViewportBounds>[1];
  navigateToTarget: (target: NonNullable<ReturnType<typeof historyRevealTarget>>, options: { preserveVisibleAxes: boolean }) => void;
};

export type RevealDestination = {
  sheetId: string;
  target: NonNullable<ReturnType<typeof historyRevealTarget>>;
  outsideViewport: boolean;
};

export function resolveHistoryRevealDestination(feedback: ContentHistoryFeedback, sheets: readonly SheetDocument[], creatingAxes: Readonly<Record<string, CreatingGridAxes>>, controller: HistoryRevealController): RevealDestination | undefined {
  const destination = sheets.find((sheet) => feedback.after.some((cell) => cell.sheetId === sheet.id));
  if (!destination || !controller.workspaceSurfaceSize) return;
  const cell = feedback.after.find((entry) => entry.sheetId === destination.id)!;
  const frame = Array.from(controller.workspaceSurfaceRef.current?.querySelectorAll<HTMLElement>('article.sheet-frame') ?? [])
    .find((entry) => entry.dataset.sheetId === destination.id);
  const scrollport = frame?.querySelector<HTMLElement>('.sheet-frame-body') ?? null;
  const target = historyRevealTarget(destination, cell, scrollport, creatingAxes[destination.id]);
  if (!target) return;
  const bounds = workspaceViewportBounds(controller.workspaceSurfaceSize, controller.viewport);
  const outsideViewport = target.left < bounds.left || target.right > bounds.right || target.top < bounds.top || target.bottom > bounds.bottom;
  return { sheetId: destination.id, target, outsideViewport };
}

export function useWorkspaceHistoryReveal(
  feedback: ContentHistoryFeedback | undefined, editing: boolean, sheets: readonly SheetDocument[],
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>, controller: HistoryRevealController,
  revealDestination?: (destination: RevealDestination) => void,
) {
  const revealedIdentity = useRef<string>();
  useEffect(() => {
    if (!feedback || editing) return;
    if (revealedIdentity.current === feedback.identity) return;
    const destination = resolveHistoryRevealDestination(feedback, sheets, creatingAxes, controller);
    if (!destination) return;
    revealedIdentity.current = feedback.identity;
    if (revealDestination) {
      revealDestination(destination);
    } else if (destination.outsideViewport) {
      controller.navigateToTarget(destination.target, { preserveVisibleAxes: true });
    }
  }, [feedback, creatingAxes, controller, editing, sheets, revealDestination]);
}
