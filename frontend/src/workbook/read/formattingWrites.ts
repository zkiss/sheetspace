import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { AppearancePatch, CellAppearance, FormatWrite, SheetDocument } from '@workbook/core/model';
import { validateFormattingSelection, type FormattingSelection, type ValidFormattingSelection } from './formattingSelection';

/** Materializes exactly one local property write for each target in a validated scope. */
export function materializeFormattingWrites<Property extends keyof CellAppearance>(
  selection: ValidFormattingSelection,
  property: Property,
  value: NonNullable<CellAppearance[Property]> | null,
): readonly FormatWrite[] {
  if (selection.mode === 'rows') {
    const writes: FormatWrite[] = [];
    for (const rowId of selection.selectedRows) {
      writes.push({ scope: 'row', targetId: rowId, properties: { [property]: value } });
    }
    return writes;
  }
  if (selection.mode === 'columns') {
    const writes: FormatWrite[] = [];
    for (const columnId of selection.selectedColumns) {
      writes.push({ scope: 'column', targetId: columnId, properties: { [property]: value } });
    }
    return writes;
  }
  const writes: FormatWrite[] = [];
  for (const rowId of selection.selectedRows) {
    for (const columnId of selection.selectedColumns) {
      writes.push({
        scope: 'cell',
        targetId: cellIdentityKey({ rowId: rowId, columnId: columnId }),
        properties: { [property]: value },
      });
    }
  }
  return writes;
}

export function selectionFormattingWrites<Property extends keyof CellAppearance>(
  sheet: SheetDocument | undefined,
  selection: FormattingSelection | null,
  property: Property,
  value: NonNullable<CellAppearance[Property]> | null,
): readonly FormatWrite[] {
  const validated = validateFormattingSelection(sheet, selection);
  return validated.valid ? materializeFormattingWrites(validated, property, value) : [];
}

/** Rejects non-control patches so a formatting action always changes one property. */
export function selectionAppearanceWrites(
  sheet: SheetDocument | undefined,
  selection: FormattingSelection | null,
  properties: AppearancePatch,
): readonly FormatWrite[] {
  const names = Object.keys(properties) as (keyof CellAppearance)[];
  if (names.length !== 1) return [];
  const property = names[0]!;
  const value = properties[property];
  return value === undefined ? [] : selectionFormattingWrites(sheet, selection, property, value);
}
