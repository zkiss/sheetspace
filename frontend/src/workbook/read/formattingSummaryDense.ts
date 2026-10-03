import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { resolvePreloadedAppearanceProperty } from '@workbook/core/numberFormat';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import type { ValidFormattingSelection } from './formattingSelection';
import { formattingProperties, type FormattingProperty, type FormattingSummary } from './formattingSummaryTypes';

type EffectiveAccumulator = { initialized: boolean; mixed: boolean; value?: unknown; key?: string };
type LocalAccumulator = { absent: boolean; present: boolean; mixed: boolean; value?: unknown; key?: string };

/**
 * Summarizes all formatting properties in one dense traversal.  It intentionally
 * uses serialized equality for every property so number-format insertion order
 * remains observable just as it was in the previous controls.
 */
export function summarizeFormattingDense(selection: ValidFormattingSelection, overrides: SheetFormatOverrides | undefined): FormattingSummary {
  const source = overrides ?? { rows: {}, columns: {}, cells: {} };
  const effective = Object.fromEntries(formattingProperties.map((property) => [property, { initialized: false, mixed: false }])) as Record<FormattingProperty, EffectiveAccumulator>;
  const local = Object.fromEntries(formattingProperties.map((property) => [property, { absent: false, present: false, mixed: false }])) as Record<FormattingProperty, LocalAccumulator>;

  const observe = (accumulator: EffectiveAccumulator, value: unknown) => {
    if (accumulator.mixed) return;
    const key = JSON.stringify(value);
    if (!accumulator.initialized) {
      accumulator.initialized = true;
      accumulator.value = value;
      accumulator.key = key;
    } else if (accumulator.key !== key) accumulator.mixed = true;
  };

  const observeLocalValue = (property: FormattingProperty, value: unknown) => {
    const accumulator = local[property];
    if (value === undefined) { accumulator.absent = true; return; }
    accumulator.present = true;
    if (accumulator.key === undefined && accumulator.value === undefined && !accumulator.mixed) {
      accumulator.value = value;
      accumulator.key = JSON.stringify(value);
    } else if (!accumulator.mixed && accumulator.key !== JSON.stringify(value)) accumulator.mixed = true;
  };

  const loadOwn = (records: Record<string, CellAppearance>, id: string) => Object.prototype.hasOwnProperty.call(records, id) ? records[id] : undefined;
  const observeEffective = (property: FormattingProperty, cell: CellAppearance | undefined, row: CellAppearance | undefined, column: CellAppearance | undefined) => {
    const accumulator = effective[property];
    if (accumulator.mixed) return;
    observe(accumulator, resolvePreloadedAppearanceProperty(cell, row, column, property));
  };

  for (let rowIndex = selection.effectiveRowStart; rowIndex <= selection.effectiveRowEnd; rowIndex += 1) {
    const rowId = selection.rows[rowIndex]!;
    const row = loadOwn(source.rows, rowId);
    for (let columnIndex = selection.effectiveColumnStart; columnIndex <= selection.effectiveColumnEnd; columnIndex += 1) {
      const columnId = selection.columns[columnIndex]!;
      const column = loadOwn(source.columns, columnId);
      const cell = loadOwn(source.cells, cellIdentityKey({ rowId, columnId }));
      for (const property of formattingProperties) {
        if (selection.mode === 'cells') observeLocalValue(property, cell?.[property]);
        observeEffective(property, cell, row, column);
      }
    }
  }
  if (selection.mode !== 'cells') {
    // Effective coverage is Cartesian, while local axis state is only the write axis.
    const records = selection.mode === 'rows' ? source.rows : source.columns;
    const start = selection.mode === 'rows' ? selection.rowStart : selection.columnStart;
    const end = selection.mode === 'rows' ? selection.rowEnd : selection.columnEnd;
    const ids = selection.mode === 'rows' ? selection.rows : selection.columns;
    for (let index = start; index <= end; index += 1) {
      const record = loadOwn(records, ids[index]!);
      for (const property of formattingProperties) observeLocalValue(property, record?.[property]);
    }
  }

  return Object.fromEntries(formattingProperties.map((property) => {
    const effectiveState = effective[property];
    const localState = local[property];
    const localOverrideState = !localState.present ? 'inherited' : localState.absent || localState.mixed ? 'mixed' : 'explicit';
    return [property, {
      effectiveValue: effectiveState.mixed ? null : effectiveState.value,
      localValue: localOverrideState === 'explicit' ? localState.value : null,
      localOverrideState,
      hasLocalOverrides: localState.present,
    }];
  })) as FormattingSummary;
}
