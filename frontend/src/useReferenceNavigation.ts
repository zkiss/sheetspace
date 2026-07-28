import { useEffect, useRef, useState } from 'react';
import { cellKey, type CellRange, type Sheet, type Workbook } from './workbook';
import type { ActiveCellSelection } from './appTypes';
import type { FormulaInspectionReference } from './formulaInspection';
import { rangeFitsSheetViewport } from './gridGeometry';
import {
  clampSheetFrameSize,
  type WorkspaceTargetRect,
} from './workspaceGeometry';

const NAVIGATION_HIGHLIGHT_MS = 1200;
const NAVIGATION_TRANSITION_MS = 180;

function normalizedRange(reference: FormulaInspectionReference): CellRange {
  if (reference.target.kind === 'range') {
    const { start, end } = reference.target.range;
    return {
      start: {
        columnIndex: Math.min(start.columnIndex, end.columnIndex),
        rowIndex: Math.min(start.rowIndex, end.rowIndex),
      },
      end: {
        columnIndex: Math.max(start.columnIndex, end.columnIndex),
        rowIndex: Math.max(start.rowIndex, end.rowIndex),
      },
    };
  }

  return { start: reference.target.address, end: reference.target.address };
}

function referenceFrameRect(sheet: Sheet): WorkspaceTargetRect {
  const frameSize = clampSheetFrameSize(sheet.frameSize);
  return {
    left: sheet.position.x,
    top: sheet.position.y,
    right: sheet.position.x + frameSize.width,
    bottom: sheet.position.y + frameSize.height,
  };
}

export function useReferenceNavigation({
  navigateToTarget,
  onSelectReferenceTarget,
  workbook,
}: {
  navigateToTarget: (
    workspace: HTMLElement,
    target: WorkspaceTargetRect,
    forceOversized?: boolean,
  ) => void;
  onSelectReferenceTarget: (selection: ActiveCellSelection) => void;
  workbook: Workbook;
}) {
  const workspaceSurfaceRef = useRef<HTMLElement>(null);
  const [navigationHighlight, setNavigationHighlight] =
    useState<ActiveCellSelection | null>(null);
  const [navigationMotion, setNavigationMotion] = useState(false);

  useEffect(() => {
    if (!navigationHighlight) {
      return;
    }

    const timeout = window.setTimeout(
      () => setNavigationHighlight(null),
      NAVIGATION_HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [navigationHighlight]);

  useEffect(() => {
    if (!navigationMotion) {
      return;
    }

    const timeout = window.setTimeout(
      () => setNavigationMotion(false),
      NAVIGATION_TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [navigationMotion]);

  function navigateReference(reference: FormulaInspectionReference) {
    const targetSheet = workbook.sheets.find(
      (sheet) => sheet.id === reference.target.sheetId,
    );
    const workspace = workspaceSurfaceRef.current;
    if (!targetSheet || !workspace || !reference.navigable) {
      return;
    }

    const range = normalizedRange(reference);
    const selection: ActiveCellSelection = {
      sheetId: targetSheet.id,
      cellKey: cellKey(range.start),
      ...(reference.target.kind === 'range' ? { range } : {}),
    };
    onSelectReferenceTarget(selection);
    setNavigationHighlight(selection);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setNavigationMotion(!reduceMotion);
    navigateToTarget(
      workspace,
      referenceFrameRect(targetSheet),
      reference.target.kind === 'range' && !rangeFitsSheetViewport(range, targetSheet),
    );
  }

  return {
    navigateReference,
    navigationHighlight,
    navigationMotion,
    workspaceSurfaceRef,
  };
}
