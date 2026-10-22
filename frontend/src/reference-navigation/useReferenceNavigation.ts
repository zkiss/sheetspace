import { useEffect, useRef, useState } from 'react';
import { addressRangeOf, cellAddressOf, stableRangeAt } from '@workbook/core/cellIdentity';
import { findSheetById } from '@workbook/read/queries';
import { type CellRange } from '@workbook/core/address';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import type { ReferenceNavigationTarget } from '@grid/cellInteractionContracts';
import type { FormulaInspectionReference } from '@reference-navigation/formulaInspection';
import { detailedViewportScaleForSheet, rangeFitsSheetViewport } from '@grid/gridGeometry';
import { type WorkspaceTargetRect, workspaceRectForFrame } from '@workspace/workspaceGeometry';
import type { NavigationOperation } from './useNavigationHistory';

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
  onExplicitNavigation,
  startNavigation,
  workbook,
}: {
  navigateToTarget: (
    target: WorkspaceTargetRect,
    options?: { forceOversized?: boolean; minimumScale?: number; onSettled?: () => void },
  ) => () => void;
  onSelectReferenceTarget: (target: ReferenceNavigationTarget) => void;
  onExplicitNavigation?: (navigate: (operation: NavigationOperation | (() => void)) => void) => void;
  startNavigation?: (operation: NavigationOperation, target: ReferenceNavigationTarget, startViewport: (settled: () => void) => () => void) => void;
  workbook: Workbook;
}) {
  const nextHighlightIdentity = useRef(1);
  const [highlight, setHighlight] =
    useState<{ target: ReferenceNavigationTarget; identity: number } | null>(null);
  const [navigationMotion, setNavigationMotion] = useState(false);

  useEffect(() => {
    if (!highlight) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setHighlight(null);
      },
      NAVIGATION_HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [highlight]);

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

  function navigateTarget(target: ReferenceNavigationTarget, targetSheet: SheetDocument, options: { forceOversized?: boolean } = {}) {
    const range = target.kind === 'range' ? addressRangeOf(targetSheet.content, target.range) : target.target.cell && cellAddressOf(targetSheet.content, target.target.cell);
    if (!range) return false;
    const normalized = target.kind === 'range' ? range : { start: range, end: range };
    const navigate = (operation: NavigationOperation | (() => void)) => {
      const complete = typeof operation === 'function' && 'complete' in operation ? operation.complete : operation;
      const generation = typeof operation === 'function' && 'generation' in operation
        ? operation.generation : nextHighlightIdentity.current++;
      const navigationOperation = typeof operation === 'function' && 'complete' in operation
        ? operation : Object.assign(complete, { generation, complete });
      onSelectReferenceTarget(target);
      setHighlight({ target, identity: generation });
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      setNavigationMotion(!reduceMotion);
      const startViewport = (settled: () => void) => navigateToTarget(workspaceRectForFrame(targetSheet.frame), {
        forceOversized: options.forceOversized ?? (target.kind === 'range' && !rangeFitsSheetViewport(normalized, targetSheet)),
        minimumScale: detailedViewportScaleForSheet(targetSheet), onSettled: settled,
      });
      if (startNavigation) startNavigation(navigationOperation, target, startViewport);
      else startViewport(navigationOperation.complete);
    };
    if (onExplicitNavigation) onExplicitNavigation(navigate); else navigate(() => {});
    return true;
  }

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
    navigateTarget(target, targetSheet, { forceOversized: reference.target.kind === 'range' && !rangeFitsSheetViewport(range, targetSheet) });
  }

  return {
    navigateReference,
    navigateTarget,
    navigationHighlight: highlight?.target ?? null,
    navigationHighlightIdentity: highlight?.identity,
    navigationMotion,
  };
}
