import { describe, expect, it } from 'vitest';
import { cellTargetAt } from '@grid/cellInteraction';
import { resolveCellNavigation } from '@grid/cellNavigation';
import type { CellSelection } from './cellInteractionContracts';
import { sheetDocument } from '@test-support/workbookFactories';

function targetKey(sheet: ReturnType<typeof sheetDocument>, from: string, request: Parameters<typeof resolveCellNavigation>[3], selection: CellSelection | null = null) {
  const target = cellTargetAt(sheet, from)!;
  const resolved = resolveCellNavigation(sheet, target, selection, request);
  return resolved && cellTargetAt(sheet, from) && resolved.cell.rowId
    ? `${String.fromCharCode(65 + sheet.content.columns.indexOf(resolved.cell.columnId))}${sheet.content.rows.indexOf(resolved.cell.rowId) + 1}`
    : undefined;
}

describe('resolveCellNavigation', () => {
  const sheet = sheetDocument({ id: 'navigation', name: 'Navigation', rowCount: 6, columnCount: 6, cells: {
    A1: 'start', B1: '=A1', C1: 'end', E1: 'later',
    C2: 'up', C3: 'middle', C5: 'down', F4: 'corner',
  } });

  it.each([
    ['right within a filled run', 'A1', { key: 'ArrowRight', command: true }, 'C1'],
    ['right from a filled boundary through blanks', 'C1', { key: 'ArrowRight', command: true }, 'E1'],
    ['right from blank to content', 'D1', { key: 'ArrowRight', command: true }, 'E1'],
    ['right with no later content reaches edge', 'E1', { key: 'ArrowRight', command: true }, 'F1'],
    ['left through a filled run', 'C1', { key: 'ArrowLeft', command: true }, 'A1'],
    ['up through a filled run', 'C3', { key: 'ArrowUp', command: true }, 'C1'],
    ['down from a boundary through blanks', 'C3', { key: 'ArrowDown', command: true }, 'C5'],
    ['down with no later content reaches edge', 'C5', { key: 'ArrowDown', command: true }, 'C6'],
    ['left grid edge clamps', 'A1', { key: 'ArrowLeft', command: true }, 'A1'],
    ['up grid edge clamps', 'A1', { key: 'ArrowUp', command: true }, 'A1'],
  ] as const)('%s', (_label, from, request, expected) => {
    expect(targetKey(sheet, from, request)).toBe(expected);
  });

  it('supports Home/End occupancy conventions and empty-sheet fallbacks', () => {
    expect(targetKey(sheet, 'D1', { key: 'Home' })).toBe('A1');
    expect(targetKey(sheet, 'D3', { key: 'Home', command: true })).toBe('A1');
    expect(targetKey(sheet, 'A1', { key: 'End' })).toBe('E1');
    expect(targetKey(sheet, 'A6', { key: 'End' })).toBe('F6');
    expect(targetKey(sheet, 'A1', { key: 'End', command: true })).toBe('F5');

    const empty = sheetDocument({ id: 'empty', name: 'Empty', rowCount: 2, columnCount: 3 });
    expect(targetKey(empty, 'B2', { key: 'End' })).toBe('C2');
    expect(targetKey(empty, 'B2', { key: 'End', command: true })).toBe('A1');
  });

  it('handles Ctrl and Cmd identically and leaves Alt requests unclaimed', () => {
    expect(targetKey(sheet, 'A1', { key: 'ArrowRight', command: true })).toBe('C1');
    expect(targetKey(sheet, 'A1', { key: 'ArrowRight', command: true, shift: true })).toBe('C1');
    expect(targetKey(sheet, 'A1', { key: 'ArrowRight', alt: true })).toBeUndefined();
  });

  it('traverses normalized rectangular selections forward, backward, and with wrapping', () => {
    const anchor = cellTargetAt(sheet, 'C3')!;
    const extent = cellTargetAt(sheet, 'A1')!;
    const reversed: CellSelection = { mode: 'cells', anchor, extent };
    expect(targetKey(sheet, 'B1', { key: 'Tab' }, reversed)).toBe('C1');
    expect(targetKey(sheet, 'C1', { key: 'Tab' }, reversed)).toBe('A2');
    expect(targetKey(sheet, 'A1', { key: 'Tab', shift: true }, reversed)).toBe('C3');
    expect(targetKey(sheet, 'C2', { key: 'Enter' }, reversed)).toBe('C3');
    expect(targetKey(sheet, 'C3', { key: 'Enter' }, reversed)).toBe('A1');
    expect(targetKey(sheet, 'A1', { key: 'Enter', shift: true }, reversed)).toBe('C3');
  });

  it('falls back to adjacent movement for a single cell or whole axis selection', () => {
    const a1 = cellTargetAt(sheet, 'A1')!;
    const wholeRow: CellSelection = { mode: 'rows', anchor: a1, extent: cellTargetAt(sheet, 'C1')! };
    expect(targetKey(sheet, 'B2', { key: 'Tab' })).toBe('C2');
    expect(targetKey(sheet, 'B2', { key: 'Enter', shift: true }, wholeRow)).toBe('B1');
  });

  it('rejects stale identities and zero-length axes deterministically', () => {
    expect(resolveCellNavigation(sheet, { sheetId: sheet.id, cell: { rowId: 'gone', columnId: 'gone' } }, null, { key: 'ArrowRight' })).toBeUndefined();
    const noRows = { ...sheet, content: { ...sheet.content, rows: [] } };
    expect(resolveCellNavigation(noRows, { sheetId: sheet.id, cell: { rowId: 'gone', columnId: 'gone' } }, null, { key: 'Home' })).toBeUndefined();
  });
});
