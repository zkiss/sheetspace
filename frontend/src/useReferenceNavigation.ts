import { useEffect, useRef, useState } from 'react';
import {
  addressRangeOf,
  cellAddressOf,
  cellKey,
  findSheetById,
  type CellRange,
  type SheetDocument,
  type Workbook,
} from './workbook';
import type { ActiveCellSelection } from './appTypes';
import type { FormulaInspectionReference } from './formulaInspection';
import { rangeFitsSheetViewport } from './gridGeometry';
import {
  clampSheetFrameSize,
  type WorkspaceTargetRect,
} from './workspaceGeometry';

const NAVIGATION_HIGHLIGHT_MS = 1200;
const NAVIGATION_TRANSITION_MS = 180;

function normalizedRange(reference: FormulaInspectionReference, sheet: SheetDocument): CellRange | undefined {
  if (reference.target.kind === 'range') {
    if (!reference.target.range) return undefined;
    const resolved = addressRangeOf(sheet.content, reference.target.range);
    if (!resolved) return undefined;
    const { start, end } = resolved;
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

  const address = reference.target.identity
    ? cellAddressOf(sheet.content, reference.target.identity)
    : undefined;
  return address ? { start: address, end: address } : undefined;
}

function referenceFrameRect(sheet: SheetDocument): WorkspaceTargetRect {
  const frameSize = clampSheetFrameSize(sheet.frame.size);
  return {
    left: sheet.frame.position.x,
    top: sheet.frame.position.y,
    right: sheet.frame.position.x + frameSize.width,
    bottom: sheet.frame.position.y + frameSize.height,
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
    const targetSheet = findSheetById(workbook, reference.target.sheetId);
    const workspace = workspaceSurfaceRef.current;
    if (!targetSheet || !workspace || !reference.navigable) {
      return;
    }

    const range = normalizedRange(reference, targetSheet);
    if (!range) return;
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
