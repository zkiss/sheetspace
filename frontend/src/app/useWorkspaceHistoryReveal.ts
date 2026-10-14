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

export function useWorkspaceHistoryReveal(
  feedback: ContentHistoryFeedback | undefined, editing: boolean, sheets: readonly SheetDocument[],
  creatingAxes: Readonly<Record<string, CreatingGridAxes>>, controller: Controller,
) {
  const revealedIdentity = useRef<string>();
  const pendingMeasurement = useRef<string>();
  useEffect(() => {
    if (!feedback || editing) return;
    const destination = sheets.find((sheet) => feedback.after.some((cell) => cell.sheetId === sheet.id));
    if (!destination || !controller.workspaceSurfaceSize) return;
    if (revealedIdentity.current === feedback.identity && pendingMeasurement.current !== feedback.identity) return;
    const cell = feedback.after.find((entry) => entry.sheetId === destination.id)!;
    const frame = Array.from(controller.workspaceSurfaceRef.current?.querySelectorAll<HTMLElement>('article.sheet-frame') ?? [])
      .find((entry) => entry.dataset.sheetId === destination.id);
    const scrollport = frame?.querySelector<HTMLElement>('.sheet-frame-body') ?? null;
    if (pendingMeasurement.current === feedback.identity && !scrollport) return;
    const target = historyRevealTarget(destination, cell, scrollport, creatingAxes[destination.id]);
    if (!target) return;
    revealedIdentity.current = feedback.identity;
    pendingMeasurement.current = undefined;
    const bounds = workspaceViewportBounds(controller.workspaceSurfaceSize, controller.viewport);
    if (target.left < bounds.left || target.right > bounds.right || target.top < bounds.top || target.bottom > bounds.bottom) {
      controller.navigateToTarget(target, { preserveVisibleAxes: true });
      if (!scrollport) pendingMeasurement.current = feedback.identity;
    }
  }, [feedback?.identity, creatingAxes, controller, editing, sheets]);
}
