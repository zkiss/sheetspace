import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { commitCellRawContent } from './operations';
import { formulaRawForDisplay } from '../formula/reference';
import { applyAxisPermutation, gatherAxis, shiftAxis, type ReorderAxis } from './reorderAxis';

function fixture() {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 8, columnCount: 8, cells: { A1: '7' }, presentation: { rowHeights: { 's:row:1': 37 }, columnWidths: { 's:column:1': 91 }, formatOverrides: { rows: { 's:row:1': { fontWeight: 'bold' } }, columns: {}, cells: {} } } });
  return workbookWithSheets([{ ...sheet, columnNames: { 's:column:1': 'Price' } }, sheetDocument({ id: 'other', name: 'Other', rowCount: 8, columnCount: 8 })]);
}

for (const axis of ['row', 'column'] as const) {
  const order = (axis: ReorderAxis) => Array.from({ length: 8 }, (_, i) => `s:${axis}:${i + 1}`);
  describe(`${axis} reorder`, () => {
    it('gathers in source order at source-order gaps including footprint and edges', () => {
      const w = fixture(), ids = order(axis), selected = [ids[5]!, ids[1]!, ids[3]!];
      const result = gatherAxis(w, 's', axis, selected, 7);
      expect(result.status).toBe('changed');
      if (result.status !== 'changed') return;
      expect(result.after).toEqual([ids[0], ids[2], ids[4], ids[6], ids[1], ids[3], ids[5], ids[7]]);
      expect(gatherAxis(w, 's', axis, selected, 2)).toMatchObject({ status: 'changed', after: [ids[0], ids[1], ids[3], ids[5], ids[2], ids[4], ids[6], ids[7]] });
      expect(gatherAxis(w, 's', axis, [ids[1]!], 0)).toMatchObject({ status: 'changed', after: [ids[1], ids[0], ...ids.slice(2)] });
      expect(gatherAxis(w, 's', axis, [ids[0]!], 8)).toMatchObject({ status: 'changed', after: [...ids.slice(1), ids[0]] });
      expect(gatherAxis(w, 's', axis, [ids[1]!], 2)).toEqual({ status: 'unchanged', workbook: w });
      expect(applyAxisPermutation(result.workbook, 's', axis, result.before)).toMatchObject({ status: 'changed', after: ids });
    });
    it('shifts separate groups and blocks at boundaries', () => {
      const w = fixture(), ids = order(axis);
      expect(shiftAxis(w, 's', axis, [ids[1]!, ids[3]!, ids[5]!], 1)).toMatchObject({ status: 'changed', after: [ids[0], ids[2], ids[1], ids[4], ids[3], ids[6], ids[5], ids[7]] });
      expect(shiftAxis(w, 's', axis, [ids[2]!, ids[3]!], -1)).toMatchObject({ status: 'changed', after: [ids[0], ids[2], ids[3], ids[1], ...ids.slice(4)] });
      expect(shiftAxis(w, 's', axis, [ids[0]!, ids[3]!], -1)).toEqual({ status: 'unchanged', workbook: w });
      expect(shiftAxis(w, 's', axis, [ids[7]!], 1)).toEqual({ status: 'unchanged', workbook: w });
    });
    it('rejects stale selections, bad gaps and permutations atomically', () => {
      const w = fixture(), ids = order(axis);
      for (const selected of [[], [ids[0]!, ids[0]!], ['foreign']]) expect(gatherAxis(w, 's', axis, selected, 0)).toMatchObject({ status: 'rejected', reason: 'invalid-selection', workbook: w });
      for (const gap of [-1, 9, 0.5, NaN]) expect(gatherAxis(w, 's', axis, [ids[0]!], gap)).toMatchObject({ status: 'rejected', reason: 'invalid-gap' });
      for (const permutation of [ids.slice(1), [...ids.slice(0, 7), ids[0]!], [...ids.slice(0, 7), 'foreign']]) expect(applyAxisPermutation(w, 's', axis, permutation)).toMatchObject({ status: 'rejected', reason: 'invalid-permutation' });
      expect(applyAxisPermutation(w, 's', axis, ids)).toEqual({ status: 'unchanged', workbook: w });
      expect(shiftAxis(w, 'missing', axis, [ids[0]!], 1)).toMatchObject({ status: 'rejected', reason: 'unknown-sheet' });
    });
  });
}

describe('reorder identity integration', () => {
  it('guards model columns while permitting rows', () => {
    const w = fixture(); w.documents.s!.modelId = 'model';
    expect(gatherAxis(w, 's', 'column', ['s:column:1'], 8)).toMatchObject({ status: 'rejected', reason: 'model-columns' });
    expect(shiftAxis(w, 's', 'row', ['s:row:1'], 1).status).toBe('changed');
  });
  it('keeps cells, metadata and stable cross-sheet references while projecting new order', () => {
    const w = commitCellRawContent(fixture(), 'other', 'A1', '=@Sheet!%A[1]');
    const raw = Object.values(w.documents.other!.content.cells)[0]!;
    const result = shiftAxis(w, 's', 'row', ['s:row:1'], 1);
    expect(result.status).toBe('changed'); if (result.status !== 'changed') return;
    const next = result.workbook;
    expect(next.documents.s!.content.cells).toBe(w.documents.s!.content.cells);
    expect(next.documents.s!.presentation).toBe(w.documents.s!.presentation);
    expect(next.documents.s!.columnNames).toBe(w.documents.s!.columnNames);
    expect(next.documents.other).toBe(w.documents.other);
    expect(formulaRawForDisplay(raw, next, 'other')).toBe('=@Sheet!A[2]');
    expect(projectGridAxes(next.documents.s!.content).rows[0]).toMatchObject({ id: 's:row:2', durableIndex: 0 });
    expect(calculationProjection(next).sheets[0]!.rows[0]).toBe('s:row:2');
  });
});

it('recalculates a cross-sheet range after both endpoints reverse order', async () => {
  const { FormulaCalculation } = await import('@calculation/formulaCalculation');
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 3, columnCount: 3, cells: { A1: '1', B2: '2', C3: '3' } });
  const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 1 });
  const original = commitCellRawContent(workbookWithSheets([source, output]), 'output', 'A1', '=SUM(@Source!A[1]:C[3])');
  const calculation = new FormulaCalculation();
  expect(calculation.updateStored(calculationProjection(original), original, { kind: 'structure' }).output.A1).toMatchObject({ value: 6 });
  const rows = applyAxisPermutation(original, 'source', 'row', [...source.content.rows].reverse());
  expect(rows.status).toBe('changed'); if (rows.status !== 'changed') return;
  const columns = applyAxisPermutation(rows.workbook, 'source', 'column', [...source.content.columns].reverse());
  expect(columns.status).toBe('changed'); if (columns.status !== 'changed') return;
  const next = columns.workbook;
  expect(calculation.updateStored(calculationProjection(next), next, { kind: 'structure' }).output.A1).toMatchObject({ value: 6 });
  const raw = Object.values(next.documents.output!.content.cells)[0]!;
  expect(formulaRawForDisplay(raw, next, 'output')).toBe('=SUM(@Source!C[3]:A[1])');
});

it.each(['row', 'column'] as const)('matches gather and shift semantics for every selection and gap on a small %s axis', (axis) => {
  const sheet = sheetDocument({ id: 'small', name: 'Small', rowCount: 4, columnCount: 4 });
  const w = workbookWithSheets([sheet]);
  const ids = axis === 'row' ? sheet.content.rows : sheet.content.columns;
  for (let mask = 1; mask < 16; mask += 1) {
    const selected = ids.filter((_, index) => mask & (1 << index));
    for (let gap = 0; gap <= ids.length; gap += 1) {
      const left = ids.slice(0, gap).filter((id) => !selected.includes(id));
      const right = ids.slice(gap).filter((id) => !selected.includes(id));
      const expected = [...left, ...selected, ...right];
      const result = gatherAxis(w, 'small', axis, selected, gap);
      expect(result.status).toBe(expected.every((id, i) => id === ids[i]) ? 'unchanged' : 'changed');
      if (result.status === 'changed') expect(result.after).toEqual(expected);
    }
    for (const direction of [-1, 1] as const) {
      const result = shiftAxis(w, 'small', axis, selected, direction);
      if (selected.includes(ids[direction === -1 ? 0 : 3]!)) { expect(result.status).toBe('unchanged'); continue; }
      const expected = [...ids];
      for (const id of direction === 1 ? [...selected].reverse() : selected) {
        const index = expected.indexOf(id);
        [expected[index], expected[index + direction]] = [expected[index + direction]!, expected[index]!];
      }
      expect(result).toMatchObject({ status: 'changed', after: expected });
    }
  }
});

it('rejects malformed runtime axis and direction values', () => {
  const w = fixture();
  expect(gatherAxis(w, 's', 'diagonal' as ReorderAxis, ['s:row:1'], 0)).toMatchObject({ status: 'rejected', reason: 'invalid-axis' });
  expect(shiftAxis(w, 's', 'row', ['s:row:1'], 0 as -1)).toMatchObject({ status: 'rejected', reason: 'invalid-direction' });
});
