import { useEffect, useRef } from 'react';
import type { CreatingGridAxes } from '@application/core/gridAxisCreationState';
import type { ContentHistoryFeedback } from '@application/react/useWorkbookController';
import type { SheetDocument } from '@workbook/core/model';
import { historyRevealTarget } from './historyRevealTarget';
import { workspaceViewportBounds } from '@workspace/workspaceGeometry';

type Controller = {
  workspaceSurfaceSize: { width: number; height: number } | null;
  workspaceSurfaceRef: React.RefObject<HTMLElement>;
  viewport: Parameters<typeof workspaceViewportBounds>[1];
  navigateToTarget: (target: NonNullable<ReturnType<typeof historyRevealTarget>>, options: { preserveVisibleAxes: boolean }) => void;
};

type RevealDestination = {
  sheetId: string;
  target: NonNullable<ReturnType<typeof historyRevealTarget>>;
  outsideViewport: boolean;
};

export function useWorkspaceHistoryReveal(
  feedback: ContentHistoryFeedback | undefined, editing: boolean, sheets: readonly SheetDocument[],
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>, controller: Controller,
  revealDestination?: (destination: RevealDestination) => void,
) {
  const revealedIdentity = useRef<string>();
  useEffect(() => {
    if (!feedback || editing) return;
    const destination = sheets.find((sheet) => feedback.after.some((cell) => cell.sheetId === sheet.id));
    if (!destination || !controller.workspaceSurfaceSize) return;
    if (revealedIdentity.current === feedback.identity) return;
    const cell = feedback.after.find((entry) => entry.sheetId === destination.id)!;
    const frame = Array.from(controller.workspaceSurfaceRef.current?.querySelectorAll<HTMLElement>('article.sheet-frame') ?? [])
      .find((entry) => entry.dataset.sheetId === destination.id);
    const scrollport = frame?.querySelector<HTMLElement>('.sheet-frame-body') ?? null;
    const target = historyRevealTarget(destination, cell, scrollport, creatingAxes[destination.id]);
    if (!target) return;
    revealedIdentity.current = feedback.identity;
    const bounds = workspaceViewportBounds(controller.workspaceSurfaceSize, controller.viewport);
    const outsideViewport = target.left < bounds.left || target.right > bounds.right || target.top < bounds.top || target.bottom > bounds.bottom;
    if (revealDestination) {
      revealDestination({ sheetId: destination.id, target, outsideViewport });
    } else if (outsideViewport) {
      controller.navigateToTarget(target, { preserveVisibleAxes: true });
    }
  }, [feedback, creatingAxes, controller, editing, sheets, revealDestination]);
}
