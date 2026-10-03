import { Fragment } from 'react';
import { GENERAL_NUMBER_FORMAT, NUMBER_FORMAT_PRECISION_LIMITS } from '@workbook/core/numberFormat';
import type { AppearancePatch, FormatWrite, NumberFormat, SheetDocument } from '@workbook/core/model';
import { summarizeFormatting } from '@workbook/read/formattingSummary';
import { validateFormattingSelection, type FormattingSelection } from '@workbook/read/formattingSelection';
import { materializeFormattingWrites } from '@workbook/read/formattingWrites';
import { colourControlReadout } from './colourControlReadout';
import type { AppearancePropertyControlState } from './appearanceControlState';
import { FormatIcon } from './FormatIcon';
import { ColourPicker } from './ColourPicker';
import type { FormattingSelectionProjection } from './useFormattingSelection';
import {
  appearanceControlState,
  emptyAppearanceControlState,
  formatControlState,
  type AppearanceFormattingControlState,
  type FormatControlState,
} from './formattingControlState';

export { appearanceControlState, formatControlState } from './formattingControlState';
export type { AppearanceFormattingControlState, FormatControlState } from './formattingControlState';


export function selectionFormatControlState(sheet: SheetDocument | undefined, selection: FormattingSelection | null): FormatControlState {
  const validated = validateFormattingSelection(sheet, selection);
  if (!sheet || !validated.valid) return { format: null, hasLocalOverrides: false };
  return formatControlState(summarizeFormatting(validated, sheet.presentation.formatOverrides));
}


export function selectionAppearanceControlState(sheet: SheetDocument | undefined, selection: FormattingSelection | null): AppearanceFormattingControlState {
  const validated = validateFormattingSelection(sheet, selection);
  if (!sheet || !validated.valid) return emptyAppearanceControlState();
  return appearanceControlState(summarizeFormatting(validated, sheet.presentation.formatOverrides));
}


function appearanceStateLabel(label: string, state: AppearancePropertyControlState<unknown>, scopeDescription?: string) {
  const effective = state.value === null ? 'mixed effective values' : 'one effective value';
  const local = state.localOverrideState === 'mixed' ? 'mixed local overrides' : state.localOverrideState === 'explicit' ? 'explicit local override' : 'inherited';
  return `${label}: ${scopeDescription ? `${scopeDescription}; ` : ''}${effective}; ${local}`;
}

export function NumberFormatControls({
  disabled: interactionDisabled = false,
  onWrite,
  projection,
  selection,
}: {
  disabled?: boolean;
  onWrite: (writes: readonly FormatWrite[]) => void;
  /** Workspace owns and supplies the current shared formatting projection. */
  projection: FormattingSelectionProjection;
  selection: FormattingSelection | null;
}) {
  const current = projection;
  const state = current.summary ? formatControlState(current.summary) : { format: null, hasLocalOverrides: false };
  const appearance = current.summary ? appearanceControlState(current.summary) : emptyAppearanceControlState();
  const selectionDisabled = !current.descriptor.valid;
  const { customColours } = current;
  // Modal sheet dialogs retire palette drafts/listeners without restoring
  // background focus. Reuse the pickers' disabled cancellation path.
  const disabled = interactionDisabled || selectionDisabled;
  const write = (format: NumberFormat | null) => onWrite(current.descriptor.valid
    ? materializeFormattingWrites(current.descriptor, 'numberFormat', format) : []);
  const writeAppearance = (properties: AppearancePatch) => {
    const names = Object.keys(properties) as (keyof AppearancePatch)[];
    const property = names[0];
    const value = property && properties[property];
    onWrite(current.descriptor.valid && property && value !== undefined
      ? materializeFormattingWrites(current.descriptor, property, value) : []);
  };
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
