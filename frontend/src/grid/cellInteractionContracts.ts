import type { StableCellIdentity, StableCellRange } from '@workbook/core/model';
import type { CellKey } from '@workbook/core/address';

export type CellContentCommands = {
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type CellTarget = {
  sheetId: string;
  cell: StableCellIdentity;
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

export type CellEditSession = {
  target: CellTarget;
  draft: string;
};

export type CellNavigationDirection = 'left' | 'right' | 'up' | 'down';

// A start establishes a fresh pointer owner; continuations must match it.
export type SelectionGesture = { owner: symbol; start?: boolean };
