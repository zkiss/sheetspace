import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { formattingSelectionControlState } from '@test-support/formattingSelectionControlState';
import { colourControlReadout } from './colourControlReadout';

const sheet = sheetDocument({ id: 'colours', name: 'Colours', rowCount: 3, columnCount: 3, cells: { A1: 'populated' } });
const endpoint = (row: number, column: number) => ({
  sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! },
});
const colours = { textColor: '#23855d', fillColor: '#3267a8' } as const;
const exceptions = { textColor: '#d84b4b', fillColor: '#c99c00' } as const;

function states(mode: 'cells' | 'rows' | 'columns', overrides: SheetFormatOverrides, multi = false) {
  const styled = { ...sheet, presentation: { ...sheet.presentation, formatOverrides: overrides } };
  // Reverse multi-axis endpoints to exercise inclusive, order-independent selection.
  return formattingSelectionControlState(styled, {
    mode, anchor: multi ? endpoint(2, 2) : endpoint(0, 0), extent: endpoint(0, 0),
  }).appearance;
}

describe.each(['rows', 'columns'] as const)('%s colour readouts', (mode) => {
  const group = mode;
  const ids = sheet.content[group];
  const overrides = (locals: Record<string, CellAppearance>, cells: Record<string, CellAppearance> = {}): SheetFormatOverrides => ({
    rows: {}, columns: {}, cells, [group]: locals,
  });

  it.each([false, true])('shows common axis colours with cell exceptions=%s while retaining effective state', (withExceptions) => {
    const local = Object.fromEntries(ids.map((id) => [id, colours]));
    const result = states(mode, overrides(local, withExceptions ? { [cellIdentityKey(endpoint(2, 2).cell)]: exceptions } : {}), true);
    for (const property of ['textColor', 'fillColor'] as const) {
      expect(result[property]).toEqual({ value: withExceptions ? null : colours[property], localValue: colours[property], localOverrideState: 'explicit', hasLocalOverrides: true });
      expect(colourControlReadout(result[property], mode, '#ffffff')).toMatchObject({ status: 'colour', colour: colours[property] });
    }
  });

  it('does not promote constituent cell or opposite-axis colours to axis settings', () => {
    const otherGroup = mode === 'rows' ? 'columns' : 'rows';
    const inherited = { ...overrides({}), [otherGroup]: Object.fromEntries(sheet.content[otherGroup].map((id) => [id, colours])) };
    for (const [source, expectedEffective] of [
      [inherited, colours],
      [{ ...inherited, cells: { [cellIdentityKey(endpoint(2, 2).cell)]: exceptions } }, { textColor: null, fillColor: null }],
      [overrides({}, { [cellIdentityKey(endpoint(0, 0).cell)]: colours }), { textColor: null, fillColor: null }],
    ] as const) {
      const result = states(mode, source, true);
      for (const property of ['textColor', 'fillColor'] as const) {
        expect(result[property]).toMatchObject({ value: expectedEffective[property], localValue: null, localOverrideState: 'inherited' });
        expect(colourControlReadout(result[property], mode, '#ffffff')).toMatchObject({ status: 'inherited', colour: '#ffffff' });
      }
    }
  });

  it('reports differing axis settings and mixed inherited/explicit provenance even when effective colours agree', () => {
    const allCells = Object.fromEntries(sheet.content.rows.flatMap((rowId) => sheet.content.columns.map((columnId) => [cellIdentityKey({ rowId, columnId }), colours])));
    for (const locals of [{ [ids[0]!]: colours }, { [ids[0]!]: colours, [ids[1]!]: exceptions, [ids[2]!]: colours }]) {
      const result = states(mode, overrides(locals, allCells), true);
      for (const property of ['textColor', 'fillColor'] as const) {
        expect(result[property]).toMatchObject({ value: colours[property], localValue: null, localOverrideState: 'mixed' });
        expect(colourControlReadout(result[property], mode, '#ffffff').status).toBe('mixed');
      }
    }
  });

  it('shows explicit defaults despite conflicting cell and opposite-axis settings, independently per property', () => {
    const otherGroup = mode === 'rows' ? 'columns' : 'rows';
    const result = states(mode, {
      ...overrides({ [ids[0]!]: { textColor: 'automatic', fillColor: 'none', fontWeight: 'bold' } }, { [cellIdentityKey(endpoint(0, 0).cell)]: exceptions }),
      [otherGroup]: Object.fromEntries(sheet.content[otherGroup].map((id) => [id, colours])),
    });
    for (const property of ['textColor', 'fillColor'] as const) {
      expect(result[property].localOverrideState).toBe('explicit');
      expect(colourControlReadout(result[property], mode, '#ffffff').status).toBe('none');
    }
    expect(result.fontWeight.value).toBe('bold');
    expect(result.horizontalAlignment.value).toBe('general');
  });
});

describe('unchanged cell colour readouts', () => {
  it('retains inherited reset icons for homogeneous inherited hex and mixed indicators for effective or local mixtures', () => {
    const inherited = { rows: Object.fromEntries(sheet.content.rows.map((id) => [id, colours])), columns: {}, cells: {} };
    const targetId = cellIdentityKey(endpoint(2, 2).cell);
    for (const [overrides, status] of [
      [inherited, 'inherited'],
      [{ ...inherited, cells: { [targetId]: exceptions } }, 'mixed'],
      [{ ...inherited, cells: { [targetId]: colours } }, 'mixed'],
    ] as const) {
      const result = states('cells', overrides, true);
      for (const property of ['textColor', 'fillColor'] as const) expect(colourControlReadout(result[property], 'cells', '#ffffff').status).toBe(status);
    }
  });

  it('keeps absent/invalid selection disabled-state values rather than inventing a colour', () => {
    for (const { appearance: result } of [formattingSelectionControlState(sheet, null), formattingSelectionControlState(undefined, null),
      formattingSelectionControlState(sheet, { mode: 'columns', anchor: endpoint(0, 0), extent: { ...endpoint(0, 0), sheetId: 'missing' } })]) {
      for (const property of ['textColor', 'fillColor'] as const) expect(result[property]).toEqual({ value: null, localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false });
    }
  });
});

it('keeps explicit column colour readouts when row overrides change effective colours, without changing bold/alignment', () => {
  const result = states('columns', {
    columns: Object.fromEntries(sheet.content.columns.map((id) => [id, { ...colours, fontWeight: 'bold', horizontalAlignment: 'right' }])),
    rows: { [sheet.content.rows[2]!]: { ...exceptions, fontWeight: 'normal', horizontalAlignment: 'left' } },
    cells: {},
  }, true);
  for (const property of ['textColor', 'fillColor'] as const) {
    expect(result[property]).toMatchObject({ value: null, localValue: colours[property], localOverrideState: 'explicit' });
    expect(colourControlReadout(result[property], 'columns', '#ffffff')).toMatchObject({ status: 'colour', colour: colours[property] });
  }
  expect(result.fontWeight).toMatchObject({ value: null, localValue: 'bold', localOverrideState: 'explicit' });
  expect(result.horizontalAlignment).toMatchObject({ value: null, localValue: 'right', localOverrideState: 'explicit' });
});
