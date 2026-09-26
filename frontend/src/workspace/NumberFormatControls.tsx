import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS, resolveAppearanceProperty } from '@workbook/core/numberFormat';
import type { AppearancePatch, CellAppearance, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';

type FormatSelection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: { sheetId: string; cell: { rowId: string; columnId: string } };
  extent: { sheetId: string; cell: { rowId: string; columnId: string } };
};

type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };
export type AppearanceControlState = { [Property in keyof CellAppearance]-?: { value: NonNullable<CellAppearance[Property]> | null; hasLocalOverrides: boolean } };

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
  if (selection.mode === 'rows') return rows.map((targetId) => ({ scope: 'row', targetId, properties: { numberFormat } }));
  if (selection.mode === 'columns') return columns.map((targetId) => ({ scope: 'column', targetId, properties: { numberFormat } }));
  return rows.flatMap((rowId) => columns.map((columnId) => ({
    scope: 'cell' as const,
    targetId: cellIdentityKey({ rowId, columnId }),
    properties: { numberFormat },
  })));
}

/** Writes a single appearance property without disturbing the other local properties. */
export function selectionAppearanceWrites(
  sheet: SheetDocument | undefined,
  selection: FormatSelection | null,
  properties: AppearancePatch,
): readonly FormatWrite[] {
  const propertyNames = Object.keys(properties) as (keyof CellAppearance)[];
  if (propertyNames.length !== 1) return [];
  const property = propertyNames[0]!;
  const value = properties[property];
  // Reuse the selection-to-scope mapping, then replace its number-format patch.
  return selectionFormatWrites(sheet, selection, GENERAL_NUMBER_FORMAT)
    .map((target) => ({ ...target, properties: { [property]: value } }));
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
  return effectivePropertyValues(sheet, selection, 'numberFormat', GENERAL_NUMBER_FORMAT) as readonly NumberFormat[];
}

function effectivePropertyValues<Property extends keyof CellAppearance>(
  sheet: SheetDocument,
  selection: FormatSelection,
  property: Property,
  applicationDefault: NonNullable<CellAppearance[Property]>,
): readonly NonNullable<CellAppearance[Property]>[] {
  const rowStart = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const rowEnd = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const columnStart = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const columnEnd = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (rowStart < 0 || rowEnd < 0 || columnStart < 0 || columnEnd < 0) return [];
  const rows = selection.mode === 'columns' ? sheet.content.rows : sheet.content.rows.slice(Math.min(rowStart, rowEnd), Math.max(rowStart, rowEnd) + 1);
  const columns = selection.mode === 'rows' ? sheet.content.columns : sheet.content.columns.slice(Math.min(columnStart, columnEnd), Math.max(columnStart, columnEnd) + 1);
  const overrides = sheet.presentation.formatOverrides ?? { rows: {}, columns: {}, cells: {} };
  return rows.flatMap((rowId) => columns.map((columnId) => resolveAppearanceProperty(overrides, { rowId, columnId }, property, applicationDefault)));
}

export function selectionAppearanceControlState(sheet: SheetDocument | undefined, selection: FormatSelection | null): AppearanceControlState {
  const defaults = {
    fontWeight: 'normal', horizontalAlignment: 'general', textColor: 'automatic', fillColor: 'none',
  } as const;
  const targets = selectionFormatWrites(sheet, selection, GENERAL_NUMBER_FORMAT);
  const empty = Object.fromEntries(Object.keys(defaults).map((property) => [property, { value: null, hasLocalOverrides: false }]));
  if (!sheet || !selection || targets.length === 0) return empty as AppearanceControlState;
  const overrides = sheet.presentation.formatOverrides;
  const same = (values: readonly unknown[]) => values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]));
  return Object.fromEntries(Object.entries(defaults).map(([property, applicationDefault]) => {
    const typedProperty = property as keyof typeof defaults;
    const local = targets.map((target) => (target.scope === 'row' ? overrides?.rows : target.scope === 'column' ? overrides?.columns : overrides?.cells)?.[target.targetId]?.[typedProperty]);
    const effective = effectivePropertyValues(sheet, selection, typedProperty, applicationDefault);
    return [property, { value: same(local) && same(effective) ? (local[0] ?? effective[0]!) : null, hasLocalOverrides: local.some((value) => value !== undefined) }];
  })) as AppearanceControlState;
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
  const appearance = selectionAppearanceControlState(sheet, selection);
  const disabled = !sheet || !selection;
  const write = (format: NumberFormat | null) => onWrite(selectionFormatWrites(sheet, selection, format));
  const writeAppearance = (properties: AppearancePatch) => onWrite(selectionAppearanceWrites(sheet, selection, properties));
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
            const next = event.target.valueAsNumber;
            if (!Number.isInteger(next) || next < NUMBER_FORMAT_PRECISION_LIMITS.min || next > NUMBER_FORMAT_PRECISION_LIMITS.max) return;
            write({ ...state.format, precision: next });
          }}
        />
      </label>
      <button type="button" disabled={disabled || !state.hasLocalOverrides} onClick={() => write(null)}>Inherit</button>
      <button type="button" disabled={disabled} onClick={() => write(GENERAL_NUMBER_FORMAT)}>Reset to default</button>
      <button type="button" aria-pressed={appearance.fontWeight.value === 'bold'} disabled={disabled} onClick={() => writeAppearance({ fontWeight: appearance.fontWeight.value === 'bold' ? 'normal' : 'bold' })}>Bold</button>
      <button type="button" disabled={disabled || !appearance.fontWeight.hasLocalOverrides} onClick={() => writeAppearance({ fontWeight: null })}>Inherit font weight</button>
      <label>
        Horizontal alignment
        <select aria-label="Horizontal alignment" disabled={disabled} value={appearance.horizontalAlignment.value ?? 'mixed'} onChange={(event) => writeAppearance({ horizontalAlignment: event.target.value as 'general' | 'left' | 'center' | 'right' })}>
          {appearance.horizontalAlignment.value === null && <option value="mixed">Mixed</option>}
          <option value="general">General</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
      </label>
      <button type="button" disabled={disabled || !appearance.horizontalAlignment.hasLocalOverrides} onClick={() => writeAppearance({ horizontalAlignment: null })}>Inherit horizontal alignment</button>
      <label>
        Text colour
        <input aria-label="Text colour" disabled={disabled} type="color" value={appearance.textColor.value?.startsWith('#') ? appearance.textColor.value : '#000000'} onChange={(event) => writeAppearance({ textColor: event.target.value as `#${string}` })} />
      </label>
      <button type="button" disabled={disabled} onClick={() => writeAppearance({ textColor: 'automatic' })}>Automatic text colour</button>
      <button type="button" disabled={disabled || !appearance.textColor.hasLocalOverrides} onClick={() => writeAppearance({ textColor: null })}>Inherit text colour</button>
      <label>
        Fill colour
        <input aria-label="Fill colour" disabled={disabled} type="color" value={appearance.fillColor.value?.startsWith('#') ? appearance.fillColor.value : '#ffffff'} onChange={(event) => writeAppearance({ fillColor: event.target.value as `#${string}` })} />
      </label>
      <button type="button" disabled={disabled} onClick={() => writeAppearance({ fillColor: 'none' })}>No fill</button>
      <button type="button" disabled={disabled || !appearance.fillColor.hasLocalOverrides} onClick={() => writeAppearance({ fillColor: null })}>Inherit fill colour</button>
    </div>
  );
}
