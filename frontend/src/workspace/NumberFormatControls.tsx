import { Fragment, useMemo } from 'react';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS, resolveAppearanceProperty } from '@workbook/core/numberFormat';
import type { AppearancePatch, CellAppearance, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';
import { colourControlReadout } from './colourControlReadout';
import type { AppearanceControlState, AppearancePropertyControlState, LocalOverrideState } from './appearanceControlState';
import { FormatIcon } from './FormatIcon';
import { ColourPicker } from './ColourPicker';
import { sheetCustomColours } from './colourPalette';

type FormatSelection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: { sheetId: string; cell: { rowId: string; columnId: string } };
  extent: { sheetId: string; cell: { rowId: string; columnId: string } };
};

type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };

/** Validate endpoints without enumerating or allocating selected write targets. */
function selectionBounds(sheet: SheetDocument | undefined, selection: FormatSelection | null) {
  if (!sheet || !selection || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id) return null;
  const rowStart = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const rowEnd = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const columnStart = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const columnEnd = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (rowStart < 0 || rowEnd < 0 || columnStart < 0 || columnEnd < 0) return null;
  return { rowStart, rowEnd, columnStart, columnEnd };
}

export function selectionFormatWrites(
  sheet: SheetDocument | undefined,
  selection: FormatSelection | null,
  numberFormat: NumberFormat | null,
): readonly FormatWrite[] {
  const bounds = selectionBounds(sheet, selection);
  if (!sheet || !selection || !bounds) return [];
  const { rowStart, rowEnd, columnStart, columnEnd } = bounds;
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
  const bounds = selectionBounds(sheet, selection);
  if (!bounds) return [];
  const { rowStart, rowEnd, columnStart, columnEnd } = bounds;
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
    value: null, localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false,
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
      localValue: same(local) ? local[0] ?? null : null,
      localOverrideState,
      hasLocalOverrides: localOverrideState !== 'inherited',
    }];
  })) as AppearanceControlState;
}

function appearanceStateLabel(label: string, state: AppearancePropertyControlState<unknown>, scopeDescription?: string) {
  const effective = state.value === null ? 'mixed effective values' : 'one effective value';
  const local = state.localOverrideState === 'mixed' ? 'mixed local overrides' : state.localOverrideState === 'explicit' ? 'explicit local override' : 'inherited';
  return `${label}: ${scopeDescription ? `${scopeDescription}; ` : ''}${effective}; ${local}`;
}

export function NumberFormatControls({
  disabled: interactionDisabled = false,
  onWrite,
  selection,
  sheet,
}: {
  disabled?: boolean;
  onWrite: (writes: readonly FormatWrite[]) => void;
  selection: FormatSelection | null;
  sheet: SheetDocument | undefined;
}) {
  // Frame previews, saved positions, and callback replacement do not change
  // formatting. Invalidate on the immutable formatting inputs, not sheet.frame.
  const { state, appearance, disabled: selectionDisabled, customColours } = useMemo(() => ({
    state: selectionFormatControlState(sheet, selection),
    appearance: selectionAppearanceControlState(sheet, selection),
    disabled: selectionBounds(sheet, selection) === null,
    customColours: sheetCustomColours(sheet),
  }), [sheet?.id, sheet?.content, sheet?.presentation.formatOverrides, selection]);
  // Modal sheet dialogs retire palette drafts/listeners without restoring
  // background focus. Reuse the pickers' disabled cancellation path.
  const disabled = interactionDisabled || selectionDisabled;
  const write = (format: NumberFormat | null) => onWrite(selectionFormatWrites(sheet, selection, format));
  const writeAppearance = (properties: AppearancePatch) => onWrite(selectionAppearanceWrites(sheet, selection, properties));
  const selectedKind = state.format?.kind ?? 'mixed';
  const precision = state.format?.kind === 'general' || !state.format ? '' : String(state.format.precision);
  return (
    <div className="number-format-controls" aria-label="Number formatting">
      <div className="format-control-group" role="group" aria-label="Number format">
        <button aria-label="General number format" aria-pressed={selectedKind === 'general'} disabled={disabled} onClick={() => write(GENERAL_NUMBER_FORMAT)} title="General number format" type="button">123</button>
        <button aria-label="Number format" aria-pressed={selectedKind === 'number'} disabled={disabled} onClick={() => write({ kind: 'number', precision: state.format?.kind === 'number' ? state.format.precision : 2 })} title="Number format" type="button">1.2</button>
        <button aria-label="Percent format" aria-pressed={selectedKind === 'percent'} disabled={disabled} onClick={() => write({ kind: 'percent', precision: state.format?.kind === 'percent' ? state.format.precision : 0 })} title="Percent format" type="button">%</button>
        <label>
          <span className="format-precision-label">Precision</span>
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
      </div>
      <div className="format-control-group" role="group" aria-label="Bold formatting">
        <button type="button" aria-label={appearanceStateLabel('Bold', appearance.fontWeight)} aria-describedby="bold-state" aria-pressed={appearance.fontWeight.value === 'bold'} data-local-override-state={appearance.fontWeight.localOverrideState} data-mixed={appearance.fontWeight.value === null || appearance.fontWeight.localOverrideState === 'mixed' || undefined} disabled={disabled} onClick={() => writeAppearance({ fontWeight: appearance.fontWeight.value === 'bold' ? 'normal' : 'bold' })}>B</button>
        <output id="bold-state">{appearanceStateLabel('Bold', appearance.fontWeight)}</output>
        <button aria-label="Inherit bold setting" disabled={disabled || !appearance.fontWeight.hasLocalOverrides} onClick={() => writeAppearance({ fontWeight: null })} title="Inherit bold setting" type="button"><FormatIcon kind="reset" /></button>
      </div>
      <div className="format-control-group" role="group" aria-describedby="horizontal-alignment-state" aria-label="Horizontal alignment" data-local-override-state={appearance.horizontalAlignment.localOverrideState} data-mixed={appearance.horizontalAlignment.value === null || appearance.horizontalAlignment.localOverrideState === 'mixed' || undefined}>
        <button aria-label="Align left" aria-pressed={appearance.horizontalAlignment.value === 'left'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'left' })} title="Align left" type="button"><FormatIcon kind="align-left" /></button>
        <button aria-label="Align center" aria-pressed={appearance.horizontalAlignment.value === 'center'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'center' })} title="Align center" type="button"><FormatIcon kind="align-center" /></button>
        <button aria-label="Align right" aria-pressed={appearance.horizontalAlignment.value === 'right'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'right' })} title="Align right" type="button"><FormatIcon kind="align-right" /></button>
        <button aria-label="Automatic alignment" aria-pressed={appearance.horizontalAlignment.value === 'general'} disabled={disabled} onClick={() => writeAppearance({ horizontalAlignment: 'general' })} title="Automatic alignment" type="button">A</button>
        <output id="horizontal-alignment-state">{appearanceStateLabel('Horizontal alignment', appearance.horizontalAlignment)}</output>
        <button aria-label="Inherit horizontal alignment" disabled={disabled || !appearance.horizontalAlignment.hasLocalOverrides} onClick={() => writeAppearance({ horizontalAlignment: null })} title="Inherit horizontal alignment" type="button"><FormatIcon kind="reset" /></button>
      </div>
      <div className="format-control-group" role="group" aria-label="Colours">
        {(['textColor', 'fillColor'] as const).map((property) => {
          const label = property === 'textColor' ? 'Text colour' : 'Fill colour';
          const descriptionId = property === 'textColor' ? 'text-colour-state' : 'fill-colour-state';
          const colourState = appearance[property];
          const readout = colourControlReadout(colourState, selection?.mode ?? 'cells', property === 'textColor' ? '#1f2933' : '#ffffff');
          return <Fragment key={property}>
            <ColourPicker ariaLabel={label} purpose={property === 'textColor' ? 'text' : 'fill'} descriptionId={descriptionId} colour={readout.colour}
              status={readout.status} localOverrideState={colourState.localOverrideState}
              customColours={customColours} defaultOptionLabel="No colour" disabled={disabled}
              onApply={(colour) => writeAppearance({ [property]: colour })}
              onApplyInherited={() => writeAppearance({ [property]: null })}
              onApplyDefault={() => writeAppearance({ [property]: property === 'textColor' ? 'automatic' : 'none' })} />
            <output id={descriptionId}>{appearanceStateLabel(label, colourState, readout.scopeDescription)}</output>
          </Fragment>;
        })}
      </div>
    </div>
  );
}
