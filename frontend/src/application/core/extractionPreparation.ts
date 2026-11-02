import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { FrameState, SheetDocument, StableCellIdentity, Workbook } from '@workbook/core/model';
import { validateSheetName } from '@workbook/mutations/operations';
import { findSheetById, sheetsInOrder } from '@workbook/read/queries';
import type { ClipboardSourceSnapshot } from './clipboardPayload';
import type { MoveCellIdentityMapping } from './userActions';

export type ExtractionSelection =
  | { kind: 'cells'; start: StableCellIdentity; end: StableCellIdentity }
  | { kind: 'rows'; start: string; end: string }
  | { kind: 'columns'; start: string; end: string };
export type ExtractionRequest = {
  sourceSheetId: string; selection: ExtractionSelection;
  targetSheetId: string; targetName: string; targetRows: readonly string[]; targetColumns: readonly string[];
  frame: Omit<FrameState, 'visualScale'>;
};
export type ExtractionPreparationFailure = 'unknown-source' | 'protected-source' | 'invalid-selection' | 'invalid-target-id' | 'empty-target-name' | 'duplicate-target-name' | 'invalid-target-axes' | 'invalid-frame';
export type ExtractionPreparationResult = { ok: false; reason: ExtractionPreparationFailure } | { ok: true; value: PreparedExtraction };
export type PreparedExtraction = {
  workbook: Workbook; sourceSheetId: string; targetSheetId: string;
  sourceRows: readonly string[]; sourceColumns: readonly string[];
  origin: { row: number; column: number }; extents: { rowCount: number; columnCount: number };
  mappings: readonly MoveCellIdentityMapping[]; snapshot: ClipboardSourceSnapshot;
};

function validId(id: unknown): id is string { return typeof id === 'string' && id.trim().length > 0 && !id.includes('\u0000'); }
function bounds(ids: readonly string[], start: string, end: string): [number, number] | undefined {
  const a = ids.indexOf(start), b = ids.indexOf(end);
  return a < 0 || b < 0 ? undefined : [Math.min(a, b), Math.max(a, b) + 1];
}
function select(sheet: SheetDocument, selection: ExtractionSelection): { rows: [number, number]; columns: [number, number] } | undefined {
  if (!selection || !['cells', 'rows', 'columns'].includes(selection.kind)) return undefined;
  const { rows, columns } = sheet.content;
  let rowBounds: [number, number] | undefined, columnBounds: [number, number] | undefined;
  if (selection.kind === 'cells') {
    if (!selection.start || !selection.end) return undefined;
    rowBounds = bounds(rows, selection.start.rowId, selection.end.rowId);
    columnBounds = bounds(columns, selection.start.columnId, selection.end.columnId);
  } else if (selection.kind === 'rows') {
    rowBounds = bounds(rows, selection.start, selection.end); columnBounds = [0, columns.length];
  } else if (selection.kind === 'columns') {
    rowBounds = [0, rows.length]; columnBounds = bounds(columns, selection.start, selection.end);
  }
  return rowBounds && columnBounds ? { rows: rowBounds, columns: columnBounds } : undefined;
}

export function prepareExtraction(workbook: Workbook, request: ExtractionRequest): ExtractionPreparationResult {
  if (!Object.prototype.hasOwnProperty.call(workbook.documents, request.sourceSheetId)) return { ok: false, reason: 'unknown-source' };
  const source = findSheetById(workbook, request.sourceSheetId);
  if (!source) return { ok: false, reason: 'unknown-source' };
  if (source.modelId || source.modelColumnBindings || source.modelFormulaBindings) return { ok: false, reason: 'protected-source' };
  const selected = select(source, request.selection);
  if (!selected) return { ok: false, reason: 'invalid-selection' };
  if (!validId(request.targetSheetId) || Object.prototype.hasOwnProperty.call(workbook.documents, request.targetSheetId) || workbook.manifest.sheetIds.includes(request.targetSheetId)) return { ok: false, reason: 'invalid-target-id' };
  if (typeof request.targetName !== 'string') return { ok: false, reason: 'empty-target-name' };
  const name = validateSheetName(request.targetName, sheetsInOrder(workbook));
  if (!name.ok) return { ok: false, reason: name.reason === 'empty' ? 'empty-target-name' : 'duplicate-target-name' };
  const sourceRows = source.content.rows.slice(...selected.rows), sourceColumns = source.content.columns.slice(...selected.columns);
  if (!Array.isArray(request.targetRows) || !Array.isArray(request.targetColumns)) return { ok: false, reason: 'invalid-target-axes' };
  const axes = [...request.targetRows, ...request.targetColumns];
  const existingAxes = new Set(Object.values(workbook.documents).flatMap((sheet) => [...sheet.content.rows, ...sheet.content.columns]));
  if (request.targetRows.length !== sourceRows.length || request.targetColumns.length !== sourceColumns.length || axes.some((id) => !validId(id) || existingAxes.has(id)) || new Set(axes).size !== axes.length) return { ok: false, reason: 'invalid-target-axes' };
  const frame = request.frame;
  if (!frame?.position || !frame.size || !Number.isFinite(frame.position.x) || !Number.isFinite(frame.position.y) || !Number.isFinite(frame.size.width) || !Number.isFinite(frame.size.height) || frame.size.width <= 0 || frame.size.height <= 0 || !Number.isFinite(frame.zIndex)) return { ok: false, reason: 'invalid-frame' };
  const rows = [...request.targetRows], columns = [...request.targetColumns];
  const copyAxis = <T>(record: Readonly<Record<string, T>> | undefined, from: readonly string[], to: readonly string[]): Record<string, T> => Object.fromEntries(from.flatMap((id, i) => record && Object.prototype.hasOwnProperty.call(record, id) ? [[to[i]!, structuredClone(record[id]!)]] : []));
  const overrides = source.presentation.formatOverrides;
  const cellFormats: NonNullable<SheetDocument['presentation']['formatOverrides']>['cells'] = {};
  const mappings: MoveCellIdentityMapping[] = [];
  const cells = sourceRows.map((rowId, r) => sourceColumns.map((columnId, c) => {
    const identity = { rowId, columnId }, target = { rowId: rows[r]!, columnId: columns[c]! };
    const key = cellIdentityKey(identity), targetKey = cellIdentityKey(target);
    if (overrides && Object.prototype.hasOwnProperty.call(overrides.cells, key)) cellFormats[targetKey] = structuredClone(overrides.cells[key]!);
    mappings.push({ source: { sheetId: source.id, cell: identity }, destination: { sheetId: request.targetSheetId, cell: target } });
    return { identity, raw: Object.prototype.hasOwnProperty.call(source.content.cells, key) ? source.content.cells[key]! : '' };
  }));
  const target: SheetDocument = {
    id: request.targetSheetId, revision: 0, name: name.name,
    frame: { position: { ...frame.position }, size: { ...frame.size }, zIndex: frame.zIndex, visualScale: source.frame.visualScale },
    content: { kind: 'tabular', rows, columns, cells: {} },
    columnNames: copyAxis(source.columnNames, sourceColumns, columns),
    presentation: { rowHeights: copyAxis(source.presentation.rowHeights, sourceRows, rows), columnWidths: copyAxis(source.presentation.columnWidths, sourceColumns, columns),
      ...(overrides ? { formatOverrides: { rows: copyAxis(overrides.rows, sourceRows, rows), columns: copyAxis(overrides.columns, sourceColumns, columns), cells: cellFormats } } : {}) },
  };
  const extents = { rowCount: sourceRows.length, columnCount: sourceColumns.length };
  return { ok: true, value: { workbook: { ...workbook, manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, target.id] }, documents: { ...workbook.documents, [target.id]: target } }, sourceSheetId: source.id, targetSheetId: target.id, sourceRows, sourceColumns, origin: { row: selected.rows[0], column: selected.columns[0] }, extents, mappings, snapshot: { sheetId: source.id, dimensions: extents, cells } } };
}
