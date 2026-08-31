import { useEffect, useState } from 'react';
import { addressRangeOf, cellAddressOf, stableRangeAt } from './stableCellIdentity';
import { findSheetById } from './workbookQueries';
import { type CellRange } from './cellAddress';
import { type SheetDocument, type Workbook } from './workbookModel';
import type { ReferenceNavigationTarget } from './appTypes';
import type { FormulaInspectionReference } from './formulaInspection';
import { rangeFitsSheetViewport } from './gridGeometry';
import {
  workspaceRectForFrame,
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

export function useReferenceNavigation({
  navigateToTarget,
  onSelectReferenceTarget,
  workbook,
}: {
  navigateToTarget: (
    target: ReturnType<typeof workspaceRectForFrame>,
    forceOversized?: boolean,
  ) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  workbook: Workbook;
}) {
  const [navigationHighlight, setNavigationHighlight] =
    useState<ReferenceNavigationTarget | null>(null);
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
    if (!targetSheet || !reference.navigable) {
      return;
    }

    const range = normalizedRange(reference, targetSheet);
    if (!range) return;
    const stableRange = stableRangeAt(targetSheet.content, range);
    if (!stableRange) return;
    const target: ReferenceNavigationTarget = reference.target.kind === 'range'
      ? { kind: 'range', sheetId: targetSheet.id, range: stableRange }
      : { kind: 'cell', target: { sheetId: targetSheet.id, cell: stableRange.start } };
    onSelectReferenceTarget(target);
    setNavigationHighlight(target);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setNavigationMotion(!reduceMotion);
    navigateToTarget(
      workspaceRectForFrame(targetSheet.frame),
      reference.target.kind === 'range' && !rangeFitsSheetViewport(range, targetSheet),
    );
  }

  return {
    navigateReference,
    navigationHighlight,
    navigationMotion,
  };
}
