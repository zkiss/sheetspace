export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_SHEET_FRAME_SIZE: SheetFrameSize = { width: 240, height: 160 };
export const MIN_SHEET_VISUAL_SCALE = 0.1;
export const MAX_SHEET_VISUAL_SCALE = 8;
export const DEFAULT_SHEET_VISUAL_SCALE = 1;
export function isValidSheetVisualScale(scale: number): boolean { return Number.isFinite(scale) && scale >= MIN_SHEET_VISUAL_SCALE && scale <= MAX_SHEET_VISUAL_SCALE; }
/** Normalizes user and viewport-derived scale values to the persisted sheet-scale range. */
export function clampSheetVisualScale(scale: number): number {
  const finiteScale = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_SHEET_VISUAL_SCALE;
  return Math.min(MAX_SHEET_VISUAL_SCALE, Math.max(MIN_SHEET_VISUAL_SCALE, finiteScale));
}

export type SheetId = string;
export type RowId = string;
export type ColumnId = string;
export type CellIdentityKey = string;
export type WorkbookManifest = { version: typeof WORKBOOK_SCHEMA_VERSION; revision: number; sheetIds: SheetId[] };
export type Workbook = { manifest: WorkbookManifest; documents: Record<SheetId, SheetDocument> };
export type SheetDocument = { id: SheetId; revision: number; name: string; frame: FrameState; presentation: SheetPresentation; content: TabularContent };
export type FrameState = { position: WorkspacePosition; size: SheetFrameSize; visualScale: number; zIndex: number };
export type TabularContent = { kind: 'tabular'; rows: RowId[]; columns: ColumnId[]; cells: Record<CellIdentityKey, string> };
export type StableCellIdentity = { rowId: RowId; columnId: ColumnId };
export type StableCellRange = { start: StableCellIdentity; end: StableCellIdentity };
export type WorkspacePosition = { x: number; y: number };
export type SheetFrameSize = { width: number; height: number };
export type SheetFrameProjection = Pick<SheetDocument, 'id' | 'name'> & FrameState;
export type SheetTabularProjection = Pick<SheetDocument, 'id' | 'name' | 'revision'> & TabularContent;
export type ValidationResult = { ok: true; name: string } | { ok: false; reason: 'empty' | 'duplicate' };
export type MutationResult<T> = { ok: true; value: T } | { ok: false; reason: 'empty' | 'duplicate' | 'unknown-sheet' };
export type SheetZOrderDirection = 'up' | 'down' | 'top' | 'bottom';

export type SheetPresentation = { rowHeights: Record<RowId, number>; columnWidths: Record<ColumnId, number>; formatOverrides?: SheetFormatOverrides };
export type AxisSizeWrite = { axis: 'row' | 'column'; axisId: string; size: number | null };
export type FormatWrite = { scope: 'row' | 'column' | 'cell'; targetId: string; numberFormat: NumberFormat | null };

export type NumberFormat =
  | { kind: 'general' }
  | { kind: 'number'; precision: number }
  | { kind: 'percent'; precision: number };

/** A missing property inherits; an explicit default-valued property remains an override. */
export type CellFormat = { numberFormat?: NumberFormat };
export type SheetFormatOverrides = {
  rows: Record<RowId, CellFormat>;
  columns: Record<ColumnId, CellFormat>;
  cells: Record<CellIdentityKey, CellFormat>;
};
