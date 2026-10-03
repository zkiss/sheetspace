import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { AppearancePatch, NumberFormat, SheetDocument } from '@workbook/core/model';
import { validateFormattingSelection, type FormattingSelection } from '@workbook/read/formattingSelection';
import { summarizeFormatting } from '@workbook/read/formattingSummary';
import * as summaries from '@workbook/read/formattingSummary';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { formattingModes, formattingSelection } from '@test-support/formattingProjection';
import { formattingActionWrites, numberFormatForKind, numberFormatWithPrecision, type FormattingAction } from './formattingActions';

afterEach(() => vi.restoreAllMocks());

function projection(sheet: SheetDocument, selection: FormattingSelection | null) {
  const descriptor = validateFormattingSelection(sheet, selection);
  return { descriptor, summary: descriptor.valid ? summarizeFormatting(descriptor, sheet.presentation.formatOverrides) : undefined };
}

// Independent scope/target expectations: neither the validator nor writer is the oracle.
function expectedWrites(rows: readonly string[], columns: readonly string[], mode: FormattingSelection['mode'], properties: AppearancePatch) {
  if (mode === 'rows') return rows.map((targetId) => ({ scope: 'row', targetId, properties }));
  if (mode === 'columns') return columns.map((targetId) => ({ scope: 'column', targetId, properties }));
  return rows.flatMap((rowId) => columns.map((columnId) => ({ scope: 'cell', targetId: cellIdentityKey({ rowId, columnId }), properties })));
}

describe.each(formattingModes)('%s formatting action policy', (mode) => {
  it.each(['general', 'number', 'percent'] as const)('uses %s state for all actions before and after stable-axis reorder without summary work', (kind) => {
    const base = smallSheetDocument({ id: 'actions', name: 'Actions', rowCount: 4, columnCount: 4 });
    const numberFormat: NumberFormat = kind === 'general' ? { kind } : { kind, precision: 4 };
    const sheet = { ...base, presentation: { ...base.presentation, formatOverrides: {
      rows: Object.fromEntries(base.content.rows.map((id) => [id, { numberFormat, fontWeight: 'bold' as const }])), columns: {}, cells: {},
    } } };
    const selection = formattingSelection(sheet, mode);
    const reorder = (ids: readonly string[]) => [ids[0]!, ids[3]!, ids[1]!, ids[2]!];
    const reordered = { ...sheet, content: { ...sheet.content, rows: reorder(sheet.content.rows), columns: reorder(sheet.content.columns) } };
    const actions: { action: FormattingAction; properties: AppearancePatch }[] = [
      { action: { type: 'bold' }, properties: { fontWeight: 'normal' } },
      { action: { type: 'numberFormat', kind: 'general' }, properties: { numberFormat: { kind: 'general' } } },
      { action: { type: 'numberFormat', kind: 'number' }, properties: { numberFormat: { kind: 'number', precision: kind === 'number' ? 4 : 2 } } },
      { action: { type: 'numberFormat', kind: 'percent' }, properties: { numberFormat: { kind: 'percent', precision: kind === 'percent' ? 4 : 0 } } },
      ...(['left', 'center', 'right', 'general'] as const).map((value) => ({ action: { type: 'alignment' as const, value }, properties: { horizontalAlignment: value } })),
    ];
    for (const source of [sheet, reordered]) {
      const current = projection(source, selection);
      const summarize = vi.spyOn(summaries, 'summarizeFormatting');
      for (const { action, properties } of actions) {
        const rows = source === sheet ? sheet.content.rows.slice(0, 3) : reordered.content.rows;
        const columns = source === sheet ? sheet.content.columns.slice(0, 3) : reordered.content.columns;
        expect(formattingActionWrites(current, action)).toEqual(expectedWrites(rows, columns, mode, properties));
      }
      expect(summarize).not.toHaveBeenCalled();
      summarize.mockRestore();
    }
  });

  it('uses mixed effective bold and mixed number provenance, not local settings alone', () => {
    const base = smallSheetDocument({ id: 'mixed', name: 'Mixed', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(base, mode);
    const sheet = { ...base, presentation: { ...base.presentation, formatOverrides: {
      rows: Object.fromEntries(base.content.rows.map((id) => [id, { fontWeight: 'bold' as const, numberFormat: { kind: 'number' as const, precision: 4 } }])),
      columns: {}, cells: { [cellIdentityKey(selection.anchor.cell)]: { fontWeight: 'normal' as const, numberFormat: { kind: 'percent' as const, precision: 3 } } },
    } } };
    const current = projection(sheet, selection);
    const rows = sheet.content.rows.slice(0, 3); const columns = sheet.content.columns.slice(0, 3);
    expect(formattingActionWrites(current, { type: 'bold' })).toEqual(expectedWrites(rows, columns, mode, { fontWeight: 'bold' }));
    expect(formattingActionWrites(current, { type: 'numberFormat', kind: 'number' })).toEqual(expectedWrites(rows, columns, mode, { numberFormat: { kind: 'number', precision: 2 } }));
  });

  it('toggles common inherited bold but defaults number precision when uniform effective formatting has mixed local provenance', () => {
    const sheet = smallSheetDocument({ id: 'provenance', name: 'Provenance', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, mode);
    const appearance = { numberFormat: { kind: 'number' as const, precision: 4 }, fontWeight: 'bold' as const };
    const source = { rows: {}, columns: {}, cells: {} };
    const inherited = mode === 'columns' ? 'rows' : 'columns';
    const local = mode === 'cells' ? 'cells' : mode;
    const localId = mode === 'cells' ? cellIdentityKey(selection.anchor.cell) : sheet.content[mode][0]!;
    const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: {
      ...source, [inherited]: Object.fromEntries(sheet.content[inherited].map((id) => [id, appearance])), [local]: { [localId]: appearance },
    } } };
    const current = projection(styled, selection);
    expect(current.summary?.numberFormat).toMatchObject({ effectiveValue: appearance.numberFormat, localOverrideState: 'mixed' });
    const rows = sheet.content.rows.slice(0, 3); const columns = sheet.content.columns.slice(0, 3);
    expect(formattingActionWrites(current, { type: 'bold' })).toEqual(expectedWrites(rows, columns, mode, { fontWeight: 'normal' }));
    expect(formattingActionWrites(current, { type: 'numberFormat', kind: 'number' })).toEqual(expectedWrites(rows, columns, mode, { numberFormat: { kind: 'number', precision: 2 } }));
  });

  it('rejects removed endpoints on either axis, cleared selections and every editing/modal guard combination for every action', () => {
    const sheet = smallSheetDocument({ id: 'guards', name: 'Guards', rowCount: 4, columnCount: 4 });
    const selection = formattingSelection(sheet, mode);
    const valid = projection(sheet, selection);
    const invalid = [projection(sheet, null), ...(['rows', 'columns'] as const).map((axis) =>
      projection({ ...sheet, content: { ...sheet.content, [axis]: sheet.content[axis].slice(0, 2) } }, selection))];
    const actions: FormattingAction[] = [{ type: 'bold' }, ...(['general', 'number', 'percent'] as const).map((kind) => ({ type: 'numberFormat' as const, kind })),
      ...(['left', 'center', 'right', 'general'] as const).map((value) => ({ type: 'alignment' as const, value }))];
    for (const action of actions) {
      for (const current of invalid) expect(formattingActionWrites(current, action)).toEqual([]);
      for (const guards of [{ editing: true, modal: false }, { editing: false, modal: true }, { editing: true, modal: true }]) {
        expect(formattingActionWrites(valid, action, guards)).toEqual([]);
      }
      expect(formattingActionWrites(valid, action, { editing: false, modal: false })).not.toHaveLength(0);
    }
  });
});

describe('number format action values', () => {
  it('keeps kind actions in canonical property order while precision edits preserve the existing order', () => {
    const current = { precision: 4, kind: 'number' as const };
    expect(JSON.stringify(numberFormatForKind(current, 'number'))).toBe('{"kind":"number","precision":4}');
    expect(JSON.stringify(numberFormatWithPrecision(current, 5))).toBe('{"precision":5,"kind":"number"}');
  });

  it.each([null, { kind: 'general' }, { kind: 'number', precision: 0 }, { kind: 'percent', precision: 10 }] as const)('chooses defaults or preserves matching precision from %j', (current) => {
    expect(numberFormatForKind(current, 'general')).toEqual({ kind: 'general' });
    expect(numberFormatForKind(current, 'number')).toEqual({ kind: 'number', precision: current?.kind === 'number' ? 0 : 2 });
    expect(numberFormatForKind(current, 'percent')).toEqual({ kind: 'percent', precision: current?.kind === 'percent' ? 10 : 0 });
  });

  it.each(['number', 'percent'] as const)('accepts only integer precision 0–10 for %s without mutating the current format', (kind) => {
    const current = { kind, precision: 4 };
    for (const precision of [0, 1, 5, 10]) expect(numberFormatWithPrecision(current, precision)).toEqual({ kind, precision });
    for (const precision of [-1, 11, 1.5, NaN, Infinity, -Infinity]) expect(numberFormatWithPrecision(current, precision)).toBeNull();
    expect(current).toEqual({ kind, precision: 4 });
    expect(numberFormatWithPrecision(null, 2)).toBeNull();
    expect(numberFormatWithPrecision({ kind: 'general' }, 2)).toBeNull();
  });
});
