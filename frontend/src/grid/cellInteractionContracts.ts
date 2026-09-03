import type { StableCellIdentity, StableCellRange } from '@workbook/core/model';

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
