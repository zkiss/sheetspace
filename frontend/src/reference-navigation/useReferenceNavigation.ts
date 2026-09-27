import { useEffect, useState } from 'react';
import { addressRangeOf, cellAddressOf, stableRangeAt } from '@workbook/core/cellIdentity';
import { findSheetById } from '@workbook/read/queries';
import { type CellRange } from '@workbook/core/address';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import type { ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import type { FormulaInspectionReference } from '@reference-navigation/formulaInspection';
import { detailedViewportScaleForSheet, rangeFitsSheetViewport, workspaceRectForSheetRange } from '@grid/gridGeometry';

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
    target: ReturnType<typeof workspaceRectForSheetRange>,
    options?: { forceOversized?: boolean; minimumScale?: number },
  ) => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  workbook: Workbook;
}) {
  const [navigationHighlight, setNavigationHighlight] =
    useState<ReferenceNavigationTarget | null>(null);
  const [navigationRevealSheetId, setNavigationRevealSheetId] = useState<string | null>(null);
  const [releaseRevealOnFocus, setReleaseRevealOnFocus] = useState(false);
  const [navigationMotion, setNavigationMotion] = useState(false);

  function releaseNavigationReveal(sheetId: string) {
    if (!releaseRevealOnFocus) return;
    setNavigationRevealSheetId((current) => current === sheetId ? null : current);
  }

  useEffect(() => {
    if (!navigationHighlight) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setNavigationHighlight(null);
        setNavigationRevealSheetId(null);
        setReleaseRevealOnFocus(false);
      },
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
    // normalizedRange only returns addresses resolved from this same durable content.
    const stableRange = stableRangeAt(targetSheet.content, range)!;
    const target: ReferenceNavigationTarget = reference.target.kind === 'range'
      ? { kind: 'range', sheetId: targetSheet.id, range: stableRange }
      : { kind: 'cell', target: { sheetId: targetSheet.id, cell: stableRange.start } };
    onSelectReferenceTarget(target);
    setNavigationHighlight(target);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Reduced motion releases ownership at the focus handoff; animated
    // navigation retains the established highlight/reveal lifetime.
    setNavigationRevealSheetId(targetSheet.id);
    setReleaseRevealOnFocus(reduceMotion);
    setNavigationMotion(!reduceMotion);
    navigateToTarget(
      workspaceRectForSheetRange(range, targetSheet),
      {
        forceOversized: reference.target.kind === 'range' && !rangeFitsSheetViewport(range, targetSheet),
        // The viewport scale alone is not the rendered scale for a miniature
        // sheet. Require enough viewport scale to cross the detail boundary.
        minimumScale: detailedViewportScaleForSheet(targetSheet),
      },
    );
  }

  return {
    navigateReference,
    navigationHighlight,
    navigationRevealSheetId,
    releaseNavigationReveal,
    navigationMotion,
  };
}
