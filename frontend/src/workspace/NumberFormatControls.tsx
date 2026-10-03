import { Fragment, useMemo } from 'react';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS } from '@workbook/core/numberFormat';
import type { AppearancePatch, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';
import { summarizeFormatting, type FormattingSummary } from '@workbook/read/formattingSummary';
import { validateFormattingSelection, type FormattingSelection } from '@workbook/read/formattingSelection';
import { selectionAppearanceWrites, selectionFormattingWrites } from '@workbook/read/formattingWrites';
import { colourControlReadout } from './colourControlReadout';
import type { AppearanceControlState, AppearancePropertyControlState } from './appearanceControlState';
import { FormatIcon } from './FormatIcon';
import { ColourPicker } from './ColourPicker';
import { sheetCustomColours } from './colourPalette';

type FormatControlState = { format: NumberFormat | null; hasLocalOverrides: boolean };
type AppearanceFormattingControlState = Omit<AppearanceControlState, 'numberFormat'>;

export function selectionFormatControlState(sheet: SheetDocument | undefined, selection: FormattingSelection | null): FormatControlState {
  const validated = validateFormattingSelection(sheet, selection);
  if (!sheet || !validated.valid) return { format: null, hasLocalOverrides: false };
  return formatControlState(summarizeFormatting(validated, sheet.presentation.formatOverrides));
}

export function formatControlState(summary: FormattingSummary): FormatControlState {
  const numberFormat = summary.numberFormat;
  return {
    format: numberFormat.effectiveValue === null || numberFormat.localOverrideState === 'mixed'
      ? null
      : numberFormat.localValue ?? numberFormat.effectiveValue,
    hasLocalOverrides: numberFormat.hasLocalOverrides,
  };
}

export function selectionAppearanceControlState(sheet: SheetDocument | undefined, selection: FormattingSelection | null): AppearanceFormattingControlState {
  const validated = validateFormattingSelection(sheet, selection);
  if (!sheet || !validated.valid) return emptyAppearanceControlState();
  return appearanceControlState(summarizeFormatting(validated, sheet.presentation.formatOverrides));
}

export function appearanceControlState(summary: FormattingSummary): AppearanceFormattingControlState {
  const adapt = <Value,>(property: { effectiveValue: Value | null; localValue: Value | null; localOverrideState: 'inherited' | 'explicit' | 'mixed'; hasLocalOverrides: boolean }) => ({
    value: property.effectiveValue,
    localValue: property.localValue,
    localOverrideState: property.localOverrideState,
    hasLocalOverrides: property.hasLocalOverrides,
  });
  return {
    fontWeight: adapt(summary.fontWeight),
    horizontalAlignment: adapt(summary.horizontalAlignment),
    textColor: adapt(summary.textColor),
    fillColor: adapt(summary.fillColor),
  };
}

function emptyAppearanceControlState(): AppearanceFormattingControlState {
  const empty = { value: null, localValue: null, localOverrideState: 'inherited' as const, hasLocalOverrides: false };
  return { fontWeight: empty, horizontalAlignment: empty, textColor: empty, fillColor: empty };
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
  selection: FormattingSelection | null;
  sheet: SheetDocument | undefined;
}) {
  // Frame previews, saved positions, and callback replacement do not change
  // formatting. Invalidate on the immutable formatting inputs, not sheet.frame.
  const { state, appearance, disabled: selectionDisabled, customColours } = useMemo(() => {
    const validated = validateFormattingSelection(sheet, selection);
    const summary = sheet && validated.valid ? summarizeFormatting(validated, sheet.presentation.formatOverrides) : undefined;
    return {
      state: summary ? formatControlState(summary) : { format: null, hasLocalOverrides: false },
      appearance: summary ? appearanceControlState(summary) : emptyAppearanceControlState(),
      disabled: !validated.valid,
      customColours: sheetCustomColours(sheet),
    };
  }, [sheet?.id, sheet?.content, sheet?.presentation.formatOverrides, selection]);
  // Modal sheet dialogs retire palette drafts/listeners without restoring
  // background focus. Reuse the pickers' disabled cancellation path.
  const disabled = interactionDisabled || selectionDisabled;
  const write = (format: NumberFormat | null) => onWrite(selectionFormattingWrites(sheet, selection, 'numberFormat', format));
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
