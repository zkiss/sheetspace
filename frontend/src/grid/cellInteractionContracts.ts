import type { StableCellIdentity, StableCellRange } from '@workbook/core/model';
import type { CellKey } from '@workbook/core/address';

export type CellContentCommands = {
  updateCellContent: (sheetId: string, cellKey: CellKey, raw: string) => void;
};

export type CellTarget = {
  sheetId: string;
  cell: StableCellIdentity;
};

export type ReferenceNavigationTarget =
  | { kind: 'cell'; target: CellTarget }
  | { kind: 'range'; sheetId: string; range: StableCellRange };

export type CellEditSession = {
  target: CellTarget;
  draft: string;
};

export type CellNavigationDirection = 'left' | 'right' | 'up' | 'down';
