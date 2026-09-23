import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS, resolveNumberFormat } from '@workbook/core/numberFormat';
import type { FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';

type FormatSelection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: { sheetId: string; cell: { rowId: string; columnId: string } };
  extent: { sheetId: string; cell: { rowId: string; columnId: string } };
};

type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };

export function selectionFormatWrites(
  sheet: SheetDocument | undefined,
  selection: FormatSelection | null,
  numberFormat: NumberFormat | null,
): readonly FormatWrite[] {
  if (!sheet || !selection || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id) return [];
  const rowStart = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const rowEnd = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const columnStart = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const columnEnd = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (rowStart < 0 || rowEnd < 0 || columnStart < 0 || columnEnd < 0) return [];
  const rows = sheet.content.rows.slice(Math.min(rowStart, rowEnd), Math.max(rowStart, rowEnd) + 1);
  const columns = sheet.content.columns.slice(Math.min(columnStart, columnEnd), Math.max(columnStart, columnEnd) + 1);
  if (selection.mode === 'rows') return rows.map((targetId) => ({ scope: 'row', targetId, numberFormat }));
  if (selection.mode === 'columns') return columns.map((targetId) => ({ scope: 'column', targetId, numberFormat }));
  return rows.flatMap((rowId) => columns.map((columnId) => ({
    scope: 'cell' as const,
    targetId: cellIdentityKey({ rowId, columnId }),
    numberFormat,
  })));
}

export function selectionFormatControlState(sheet: SheetDocument | undefined, selection: FormatSelection | null): FormatControlState {
  const targets = selectionFormatWrites(sheet, selection, GENERAL_NUMBER_FORMAT);
  if (!sheet || !selection || targets.length === 0) return { format: null, hasLocalOverrides: false };
  const overrides = sheet.presentation.formatOverrides;
  const local = targets.map((target) => (target.scope === 'row' ? overrides?.rows : target.scope === 'column' ? overrides?.columns : overrides?.cells)?.[target.targetId]?.numberFormat);
  const effective = effectiveFormats(sheet, selection);
  const same = (formats: readonly (NumberFormat | undefined)[]) => formats.every((format) => JSON.stringify(format) === JSON.stringify(formats[0]));
  return {
    format: same(local) && same(effective) ? local[0] ?? effective[0]! : null,
    hasLocalOverrides: local.some(Boolean),
  };
}

function effectiveFormats(sheet: SheetDocument, selection: FormatSelection): readonly NumberFormat[] {
  const rowStart = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const rowEnd = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const columnStart = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const columnEnd = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (rowStart < 0 || rowEnd < 0 || columnStart < 0 || columnEnd < 0) return [];
  const rows = selection.mode === 'columns' ? sheet.content.rows : sheet.content.rows.slice(Math.min(rowStart, rowEnd), Math.max(rowStart, rowEnd) + 1);
  const columns = selection.mode === 'rows' ? sheet.content.columns : sheet.content.columns.slice(Math.min(columnStart, columnEnd), Math.max(columnStart, columnEnd) + 1);
  const overrides = sheet.presentation.formatOverrides ?? { rows: {}, columns: {}, cells: {} };
  return rows.flatMap((rowId) => columns.map((columnId) => resolveNumberFormat(overrides, { rowId, columnId })));
}

export function NumberFormatControls({
  onWrite,
  selection,
  sheet,
}: {
  onWrite: (writes: readonly FormatWrite[]) => void;
  selection: FormatSelection | null;
  sheet: SheetDocument | undefined;
}) {
  const state = selectionFormatControlState(sheet, selection);
  const disabled = !sheet || !selection;
  const write = (format: NumberFormat | null) => onWrite(selectionFormatWrites(sheet, selection, format));
  const selectedKind = state.format?.kind ?? 'mixed';
  const precision = state.format?.kind === 'general' || !state.format ? '' : String(state.format.precision);
  return (
    <div className="number-format-controls" aria-label="Number formatting">
      <label>
        Format
        <select aria-label="Number format" disabled={disabled} value={selectedKind} onChange={(event) => {
          const kind = event.target.value;
          if (kind === 'general') write(GENERAL_NUMBER_FORMAT);
          if (kind === 'number' || kind === 'percent') write({ kind, precision: state.format?.kind === kind ? state.format.precision : kind === 'number' ? 2 : 0 });
        }}>
          {selectedKind === 'mixed' ? <option value="mixed">Mixed</option> : null}
          <option value="general">General</option>
          <option value="number">Number</option>
          <option value="percent">Percent</option>
        </select>
      </label>
      <label>
        Precision
        <input
          aria-label="Number format precision"
          disabled={disabled || selectedKind === 'general' || selectedKind === 'mixed'}
          max={NUMBER_FORMAT_PRECISION_LIMITS.max}
          min={NUMBER_FORMAT_PRECISION_LIMITS.min}
          type="number"
          value={precision}
          onChange={(event) => {
            if (state.format?.kind !== 'number' && state.format?.kind !== 'percent') return;
            const next = Number(event.target.value);
            if (!Number.isInteger(next) || next < NUMBER_FORMAT_PRECISION_LIMITS.min || next > NUMBER_FORMAT_PRECISION_LIMITS.max) return;
            write({ ...state.format, precision: next });
          }}
        />
      </label>
      <button type="button" disabled={disabled || !state.hasLocalOverrides} onClick={() => write(null)}>Inherit</button>
      <button type="button" disabled={disabled} onClick={() => write(GENERAL_NUMBER_FORMAT)}>Reset to default</button>
    </div>
  );
}
