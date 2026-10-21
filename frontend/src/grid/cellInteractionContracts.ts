import type { StableCellIdentity, StableCellRange } from '@workbook/core/model';
import type { CellKey } from '@workbook/core/address';
import type { CellWriteResult } from '@application/core/userActions';

export type CellContentCommands = {
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => CellWriteResult;
  writeCells: (writes: readonly { sheetId: string; rowId: string; columnId: string; raw: string }[]) => CellWriteResult;
};

export type CellTarget = {
  sheetId: string;
  cell: StableCellIdentity;
};

// Formula drafts are identified by durable domain IDs, not the labels currently
// projected by a grid or model dialog.  The property form is deliberately kept
// alongside the cell form so both editor surfaces can share one in-memory
// lifecycle without coupling either surface to the other.
export type ModelPropertyTarget = {
  modelId: string;
  propertyId: string;
};

export type FormulaEditTarget = CellTarget | ModelPropertyTarget;

export type FormulaDraftSession<Target extends FormulaEditTarget = FormulaEditTarget> = {
  target: Target;
  draft: string;
  selection?: { start: number; end: number };
  scrollTop?: number;
};

export type CellSelectionMode = 'cells' | 'rows' | 'columns';

// The selected rectangle is deliberately expressed in stable identities, rather
// than A1 addresses or mounted DOM nodes.  Axis projection can consequently
// change while a selection remains meaningful.
export type CellSelection = {
  mode: CellSelectionMode;
  anchor: CellTarget;
  extent: CellTarget;
};

export type ReferenceNavigationTarget =
  | { kind: 'cell'; target: CellTarget }
  | { kind: 'range'; sheetId: string; range: StableCellRange };

// Each direct-overlay mount carries a fresh identity, even when it resumes the
// same target and draft. This lets the editing lifecycle reject callbacks from
// an overlay that unmounted before a newer session opened for that target.
export type CellEditSession = FormulaDraftSession<CellTarget> & { sessionId: number };

export type CellNavigationDirection = 'left' | 'right' | 'up' | 'down';

/** A normalized keyboard movement request, kept independent of DOM events. */
export type CellNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  | 'Home' | 'End' | 'Tab' | 'Enter';

export type CellNavigationRequest = {
  key: CellNavigationKey;
  shift?: boolean;
  command?: boolean;
  alt?: boolean;
};

// A start establishes a fresh pointer owner; continuations must match it.
export type SelectionGesture = { owner: symbol; start?: boolean };
