import type { SheetId, StableCellIdentity } from '@workbook/core/model';

/** Shared decoded clipboard contract between provenance parsing and paste application. */
export type ClipboardGrid = { rows: readonly (readonly string[])[]; rowCount: number; columnCount: number };
export type ClipboardDimensions = { rowCount: number; columnCount: number };
export type ClipboardSourceCell = { identity: StableCellIdentity; raw: string };
export type ClipboardSourceSnapshot = {
  sheetId: SheetId;
  dimensions: ClipboardDimensions;
  cells: readonly (readonly ClipboardSourceCell[])[];
};
export type ClipboardParseResult =
  | { ok: true; value: { kind: 'external'; grid: ClipboardGrid } }
  | { ok: true; value: { kind: 'internal'; grid: ClipboardGrid; source: ClipboardSourceSnapshot } }
  | { ok: true; value: { kind: 'cut'; grid: ClipboardGrid; source: ClipboardSourceSnapshot } }
  | { ok: false; reason: 'malformed-tsv' };
