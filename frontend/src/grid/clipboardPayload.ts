import type { CellSelection } from './cellInteractionContracts';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import { findSheetById } from '@workbook/read/queries';
import { formulaRawForDisplay } from '@workbook/formula/reference';
import type {
  ClipboardDimensions,
  ClipboardGrid,
  ClipboardParseResult,
  ClipboardSourceSnapshot,
} from '@application/core/clipboardPayload';

export type TsvDecodeResult = { ok: true; value: ClipboardGrid } | { ok: false; reason: 'malformed-tsv' };
export type ClipboardMarker = string;

export type ClipboardCopy = { text: string; marker: ClipboardMarker; dimensions: ClipboardDimensions };
export type ClipboardCopyResult = { ok: true; value: ClipboardCopy } | { ok: false; reason: 'invalid-selection' | 'unknown-sheet' };

/**
 * Encodes a scalar or grid as RFC-4180-style TSV. Ragged input is made rectangular
 * by padding absent trailing fields, so its paste footprint is never ambiguous.
 */
export function encodeTsv(input: readonly (readonly string[])[] | string): string {
  const rows = typeof input === 'string' ? [[input]] : input;
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => quoteField(row[index] ?? '')).join('\t')).join('\n');
}

/** Decodes TSV without losing quoted delimiters, embedded newlines, or empty fields. */
export function decodeTsv(text: string): TsvDecodeResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  const finishField = () => { row.push(field); field = ''; afterQuote = false; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; afterQuote = true; }
      } else field += character;
      continue;
    }
    if (afterQuote && character !== '\t' && character !== '\n' && character !== '\r') return { ok: false, reason: 'malformed-tsv' };
    if (character === '\t') { finishField(); continue; }
    if (character === '\n') { finishRow(); continue; }
    if (character === '\r') {
      if (text[index + 1] !== '\n') return { ok: false, reason: 'malformed-tsv' };
      index += 1;
      finishRow();
      continue;
    }
    if (character === '"') {
      if (field.length > 0) return { ok: false, reason: 'malformed-tsv' };
      quoted = true;
      continue;
    }
    field += character;
  }
  if (quoted) return { ok: false, reason: 'malformed-tsv' };
  finishRow();
  const columnCount = Math.max(1, ...rows.map((candidate) => candidate.length));
  const rectangularRows = rows.map((candidate) => Array.from({ length: columnCount }, (_, index) => candidate[index] ?? ''));
  return { ok: true, value: { rows: rectangularRows, rowCount: rectangularRows.length, columnCount } };
}

/**
 * Holds only the most recent copy. A marker is necessary but insufficient: exact
 * text, decoded dimensions, and durable source identities must all still agree.
 */
export class ClipboardPayloadStore {
  private latest: { marker: ClipboardMarker; text: string; source: ClipboardSourceSnapshot } | undefined;

  copy(workbook: Workbook, selection: CellSelection): ClipboardCopyResult {
    const sheet = findSheetById(workbook, selection.anchor.sheetId);
    if (!sheet) return { ok: false, reason: 'unknown-sheet' };
    const range = selectionRange(sheet, selection);
    if (!range) return { ok: false, reason: 'invalid-selection' };
    const cells = range.rowIndices.map((rowIndex) => range.columnIndices.map((columnIndex) => {
      const identity = cellIdentityAt(sheet.content, { rowIndex, columnIndex })!;
      const raw = sheet.content.cells[cellIdentityKey(identity)] ?? '';
      return { identity, raw };
    }));
    const displayRows = cells.map((row) => row.map((cell) => cell.raw.startsWith('=') ? formulaRawForDisplay(cell.raw, workbook, sheet.id) : cell.raw));
    const text = encodeTsv(displayRows);
    const source: ClipboardSourceSnapshot = {
      sheetId: sheet.id,
      dimensions: { rowCount: cells.length, columnCount: cells[0]?.length ?? 0 },
      cells,
    };
    const marker = createMarker();
    this.latest = { marker, text, source };
    return { ok: true, value: { text, marker, dimensions: source.dimensions } };
  }

  parse(workbook: Workbook, clipboard: { text: string; marker?: ClipboardMarker }): ClipboardParseResult {
    const decoded = decodeTsv(clipboard.text);
    if (!decoded.ok) return decoded;
    const snapshot = this.latest;
    if (!snapshot || clipboard.marker !== snapshot.marker || clipboard.text !== snapshot.text
      || !sameDimensions(decoded.value, snapshot.source.dimensions) || !sourceStillValid(workbook, snapshot.source)) {
      return { ok: true, value: { kind: 'external', grid: decoded.value } };
    }
    return { ok: true, value: { kind: 'internal', grid: decoded.value, source: cloneSource(snapshot.source) } };
  }
}

function selectionRange(sheet: SheetDocument, selection: CellSelection): { rowIndices: number[]; columnIndices: number[] } | undefined {
  if (selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id) return undefined;
  const startRow = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const endRow = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const startColumn = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const endColumn = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (startRow < 0 || endRow < 0 || startColumn < 0 || endColumn < 0) return undefined;
  const rows = indicesBetween(startRow, endRow);
  const columns = indicesBetween(startColumn, endColumn);
  return {
    rowIndices: selection.mode === 'columns' ? indicesBetween(0, sheet.content.rows.length - 1) : rows,
    columnIndices: selection.mode === 'rows' ? indicesBetween(0, sheet.content.columns.length - 1) : columns,
  };
}

function indicesBetween(first: number, second: number): number[] {
  return Array.from({ length: Math.abs(second - first) + 1 }, (_, index) => Math.min(first, second) + index);
}

function sourceStillValid(workbook: Workbook, source: ClipboardSourceSnapshot): boolean {
  const sheet = findSheetById(workbook, source.sheetId);
  if (!sheet || source.cells.length !== source.dimensions.rowCount || source.cells.some((row) => row.length !== source.dimensions.columnCount)) return false;
  return source.cells.every((row) => row.every((cell) =>
    sheet.content.rows.includes(cell.identity.rowId) && sheet.content.columns.includes(cell.identity.columnId)));
}

function sameDimensions(grid: ClipboardGrid, dimensions: ClipboardDimensions): boolean {
  return grid.rowCount === dimensions.rowCount && grid.columnCount === dimensions.columnCount;
}

function quoteField(value: string): string { return /[\t\n\r"]/.test(value) ? `"${value.split('"').join('""')}"` : value; }
function createMarker(): ClipboardMarker { return `sheetspace:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`; }
function cloneSource(source: ClipboardSourceSnapshot): ClipboardSourceSnapshot {
  return { ...source, dimensions: { ...source.dimensions }, cells: source.cells.map((row) => row.map((cell) => ({ identity: { ...cell.identity }, raw: cell.raw }))) };
}
