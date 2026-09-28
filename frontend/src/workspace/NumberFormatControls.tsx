import { useEffect, useState } from 'react';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS, resolveAppearanceProperty } from '@workbook/core/numberFormat';
import type { AppearancePatch, CellAppearance, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';

type FormatSelection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: { sheetId: string; cell: { rowId: string; columnId: string } };
  extent: { sheetId: string; cell: { rowId: string; columnId: string } };
};

type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };
type LocalOverrideState = 'inherited' | 'explicit' | 'mixed';
type AppearancePropertyControlState<Value> = {
  /** The common effective value, or null when the selection has mixed values. */
  value: Value | null;
  /** Whether the selected targets inherit, explicitly set, or mix local values. */
  localOverrideState: LocalOverrideState;
  hasLocalOverrides: boolean;
};
export type AppearanceControlState = { [Property in keyof CellAppearance]-?: AppearancePropertyControlState<NonNullable<CellAppearance[Property]>> };

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
  const empty = Object.fromEntries(Object.keys(defaults).map((property) => [property, {
    value: null, localOverrideState: 'inherited', hasLocalOverrides: false,
  }]));
  if (!sheet || !selection || targets.length === 0) return empty as AppearanceControlState;
  const overrides = sheet.presentation.formatOverrides;
  const same = (values: readonly unknown[]) => values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]));
  return Object.fromEntries(Object.entries(defaults).map(([property, applicationDefault]) => {
    const typedProperty = property as keyof typeof defaults;
    const local = targets.map((target) => (target.scope === 'row' ? overrides?.rows : target.scope === 'column' ? overrides?.columns : overrides?.cells)?.[target.targetId]?.[typedProperty]);
    const effective = effectivePropertyValues(sheet, selection, typedProperty, applicationDefault);
    const localOverrideState: LocalOverrideState = local.every((value) => value === undefined)
      ? 'inherited'
      : same(local) ? 'explicit' : 'mixed';
    return [property, {
      value: same(effective) ? effective[0]! : null,
      localOverrideState,
      hasLocalOverrides: localOverrideState !== 'inherited',
    }];
  })) as AppearanceControlState;
}

function appearanceStateLabel(label: string, state: AppearancePropertyControlState<unknown>) {
  const effective = state.value === null ? 'mixed effective values' : 'one effective value';
  const local = state.localOverrideState === 'mixed' ? 'mixed local overrides' : state.localOverrideState === 'explicit' ? 'explicit local override' : 'inherited';
  return `${label}: ${effective}; ${local}`;
}

function FormatIcon({ kind }: { kind: 'align-left' | 'align-center' | 'align-right' | 'reset' }) {
  if (kind === 'reset') {
    return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 7a5 5 0 1 1 1.4 3.5M3 3v4h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg>;
  }
  const lines = kind === 'align-left'
    ? ['2', '2', '2', '2']
    : kind === 'align-center'
      ? ['4', '2', '4', '2']
      : ['2', '4', '2', '4'];
  return <svg aria-hidden="true" viewBox="0 0 16 16">
    {lines.map((left, index) => <path d={`M${left} ${3 + index * 3}h${14 - Number(left) * 2}`} key={index} stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />)}
  </svg>;
}

const BUILT_IN_COLOURS = ['#1f2933', '#52636b', '#2f747e', '#23855d', '#3267a8', '#73459a', '#b4456b', '#c85b27', '#c99c00', '#d84b4b'] as const;

function sheetCustomColours(sheet: SheetDocument | undefined) {
  const overrides = sheet?.presentation.formatOverrides;
  const seen = new Set<string>();
  for (const group of [overrides?.rows, overrides?.columns, overrides?.cells]) {
    for (const override of Object.values(group ?? {})) {
      for (const colour of [override.textColor, override.fillColor]) {
        if (colour?.startsWith('#') && !BUILT_IN_COLOURS.includes(colour as typeof BUILT_IN_COLOURS[number])) seen.add(colour);
      }
    }
  }
  return [...seen].sort(comparePaletteOrder);
}

function comparePaletteOrder(first: string, second: string) {
  const hue = (colour: string) => {
    const value = Number.parseInt(colour.slice(1), 16);
    const red = (value >> 16) / 255;
    const green = ((value >> 8) & 255) / 255;
    const blue = (value & 255) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max === min) return 361;
    return 60 * ((max === red ? (green - blue) / (max - min) : max === green ? 2 + (blue - red) / (max - min) : 4 + (red - green) / (max - min)) + 6) % 360;
  };
  return hue(first) - hue(second) || first.localeCompare(second);
}

function ColourPicker({
  ariaLabel,
  colour,
  customColours,
  disabled,
  onApply,
}: {
  ariaLabel: string;
  colour: `#${string}`;
  customColours: readonly string[];
  disabled: boolean;
  onApply: (colour: `#${string}`) => void;
}) {
  const [draft, setDraft] = useState(colour);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) setDraft(colour);
  }, [colour, open]);
  return (
    <div className="colour-picker">
      <button aria-expanded={open} aria-haspopup="dialog" aria-label={ariaLabel} className="colour-picker-trigger" disabled={disabled} onClick={() => setOpen((current) => !current)} style={{ '--colour-swatch': colour } as import('react').CSSProperties} title={ariaLabel} type="button" />
      {open ? <div aria-label={ariaLabel} className="colour-picker-popover" role="dialog">
        <span className="colour-picker-label">Palette</span>
        <div className="colour-picker-swatches">
          {BUILT_IN_COLOURS.map((swatch) => <button aria-label={`Use ${swatch}`} className="colour-picker-swatch" key={swatch} onClick={() => setDraft(swatch)} style={{ '--colour-swatch': swatch } as import('react').CSSProperties} type="button" />)}
        </div>
        {customColours.length ? <><span className="colour-picker-label">Sheet colours</span><div className="colour-picker-swatches">
          {customColours.map((swatch) => <button aria-label={`Use ${swatch}`} className="colour-picker-swatch" key={swatch} onClick={() => setDraft(swatch as `#${string}`)} style={{ '--colour-swatch': swatch } as import('react').CSSProperties} type="button" />)}
        </div></> : null}
        <label className="colour-picker-custom">Custom<input aria-label="Custom colour" onInput={(event) => setDraft(event.currentTarget.value as `#${string}`)} type="color" value={draft} /></label>
        <div className="colour-picker-actions"><button onClick={() => setOpen(false)} type="button">Cancel</button><button onClick={() => { onApply(draft); setOpen(false); }} type="button">Apply</button></div>
      </div> : null}
    </div>
  );
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
  const customColours = sheetCustomColours(sheet);
  return (
    <div className="number-format-controls" aria-label="Number formatting">
      <div className="format-control-group" aria-label="Number format">
        <button aria-label="General number format" aria-pressed={selectedKind === 'general'} disabled={disabled} onClick={() => write(GENERAL_NUMBER_FORMAT)} title="General number format" type="button">123</button>
        <button aria-label="Number format" aria-pressed={selectedKind === 'number'} disabled={disabled} onClick={() => write({ kind: 'number', precision: state.format?.kind === 'number' ? state.format.precision : 2 })} title="Number format" type="button">1.2</button>
        <button aria-label="Percent format" aria-pressed={selectedKind === 'percent'} disabled={disabled} onClick={() => write({ kind: 'percent', precision: state.format?.kind === 'percent' ? state.format.precision : 0 })} title="Percent format" type="button">%</button>
      </div>
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
      <button aria-label="Inherit number format" disabled={disabled || !state.hasLocalOverrides} onClick={() => write(null)} title="Inherit number format" type="button"><FormatIcon kind="reset" /></button>
      <button type="button" aria-label={appearanceStateLabel('Bold', appearance.fontWeight)} aria-describedby="bold-state" aria-pressed={appearance.fontWeight.value === 'bold'} data-local-override-state={appearance.fontWeight.localOverrideState} data-mixed={appearance.fontWeight.value === null || appearance.fontWeight.localOverrideState === 'mixed' || undefined} disabled={disabled} onClick={() => writeAppearance({ fontWeight: appearance.fontWeight.value === 'bold' ? 'normal' : 'bold' })}>B</button>
      <output id="bold-state">{appearanceStateLabel('Bold', appearance.fontWeight)}</output>
      <button aria-label="Inherit bold setting" disabled={disabled || !appearance.fontWeight.hasLocalOverrides} onClick={() => writeAppearance({ fontWeight: null })} title="Inherit bold setting" type="button"><FormatIcon kind="reset" /></button>
      <div className="format-control-group" aria-describedby="horizontal-alignment-state" aria-label="Horizontal alignment" data-local-override-state={appearance.horizontalAlignment.localOverrideState} data-mixed={appearance.horizontalAlignment.value === null || appearance.horizontalAlignment.localOverrideState === 'mixed' || undefined}>
        <button aria-label="Align left" aria-pressed={appearance.horizontalAlignment.value === 'left'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'left' })} title="Align left" type="button"><FormatIcon kind="align-left" /></button>
        <button aria-label="Align center" aria-pressed={appearance.horizontalAlignment.value === 'center'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'center' })} title="Align center" type="button"><FormatIcon kind="align-center" /></button>
        <button aria-label="Align right" aria-pressed={appearance.horizontalAlignment.value === 'right'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'right' })} title="Align right" type="button"><FormatIcon kind="align-right" /></button>
      </div>
      <output id="horizontal-alignment-state">{appearanceStateLabel('Horizontal alignment', appearance.horizontalAlignment)}</output>
      <button aria-label="Inherit horizontal alignment" disabled={disabled || !appearance.horizontalAlignment.hasLocalOverrides} onClick={() => writeAppearance({ horizontalAlignment: null })} title="Inherit horizontal alignment" type="button"><FormatIcon kind="reset" /></button>
      <ColourPicker ariaLabel="Text colour" colour={appearance.textColor.value?.startsWith('#') ? appearance.textColor.value : '#1f2933'} customColours={customColours} disabled={disabled} onApply={(textColor) => writeAppearance({ textColor })} />
      <output id="text-colour-state">{appearanceStateLabel('Text colour', appearance.textColor)}</output>
      <button aria-label="Automatic text colour" disabled={disabled} onClick={() => writeAppearance({ textColor: 'automatic' })} title="Automatic text colour" type="button">A</button>
      <button aria-label="Inherit text colour" disabled={disabled || !appearance.textColor.hasLocalOverrides} onClick={() => writeAppearance({ textColor: null })} title="Inherit text colour" type="button"><FormatIcon kind="reset" /></button>
      <ColourPicker ariaLabel="Fill colour" colour={appearance.fillColor.value?.startsWith('#') ? appearance.fillColor.value : '#ffffff'} customColours={customColours} disabled={disabled} onApply={(fillColor) => writeAppearance({ fillColor })} />
      <output id="fill-colour-state">{appearanceStateLabel('Fill colour', appearance.fillColor)}</output>
      <button aria-label="No fill" disabled={disabled} onClick={() => writeAppearance({ fillColor: 'none' })} title="No fill" type="button">X</button>
      <button aria-label="Inherit fill colour" disabled={disabled || !appearance.fillColor.hasLocalOverrides} onClick={() => writeAppearance({ fillColor: null })} title="Inherit fill colour" type="button"><FormatIcon kind="reset" /></button>
    </div>
  );
}
