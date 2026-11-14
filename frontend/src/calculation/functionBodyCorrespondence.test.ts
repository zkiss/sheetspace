import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { planFunctionBodyEdit, prepareFunctionBody, prepareFunctionBodyEdit, type ReconciliationWork } from '@workbook/formula/formulaPreparation';
import { setCustomFunction } from './customFunctions';
import type { CustomFunction, Workbook } from '@workbook/core/model';
import * as preparation from '@workbook/formula/formulaPreparation';
import { requireStoredFormula } from '@workbook/formula/storedFormula';

function save(workbook: Workbook, body: string, previousName?: string): Workbook {
  const definition: CustomFunction = { name: 'value', parameters: [], body };
  const result = setCustomFunction(workbook, definition, previousName);
  if (!result.ok) throw new Error(result.error);
  return result.workbook;
}

function reorder(workbook: Workbook): Workbook {
  return { ...workbook, documents: Object.fromEntries(Object.entries(workbook.documents).map(([id, sheet]) => [id, { ...sheet, content: { ...sheet.content, rows: [sheet.content.rows[1], sheet.content.rows[0], ...sheet.content.rows.slice(2)] } }])) };
}

describe('function body occurrence correspondence', () => {
  it('pairs identical spellings by occurrence even when distinct references reverse', () => {
    const old = '=@A[1]+@B[1]+@A[1]+@A[1]';
    const next = '=@B[1]+@A[1]+@A[1]+@C[1]';
    const pairs = planFunctionBodyEdit(next, old, [], []).pairs;
    expect(pairs.map(({ old: span, next: target }) => [span.start, target.start])).toEqual([[7, 1], [1, 7], [13, 13]]);
  });

  it('bounds correspondence and application work for dissimilar dense bodies across callers', () => {
    const sheets = ['first', 'second'].map((id) => sheetDocument({ id, name: id, cells: { A1: '1', A2: '2' } }));
    const workbook = workbookWithSheets(sheets);
    const measure = (count: number) => {
      const old = '=' + Array.from({ length: count }, (_, index) => `${index}+@A[1]`).join('+');
      const next = '=' + Array.from({ length: count }, (_, index) => `${index + count}+@A[1]`).join('-');
      const bindings = sheets.map((sheet) => prepareFunctionBody(old, workbook, sheet.id, []));
      const work: ReconciliationWork = { plans: 0, visits: 0, comparisons: 0, copied: 0 };
      const plan = planFunctionBodyEdit(next, old, [], [], work);
      for (const [index, sheet] of sheets.entries()) prepareFunctionBodyEdit(next, old, bindings[index], workbook, sheet.id, [], [], undefined, plan);
      expect(work.plans).toBe(1);
      expect(plan.pairs).toHaveLength(count);
      expect(work.visits).toBeLessThan(12 * (old.length + next.length + count));
      expect(work.comparisons).toBeLessThan(20 * count * Math.log2(count + 1));
      expect(work.copied).toBeLessThan(20 * (old.length + next.length + bindings.reduce((sum, value) => sum + value.length, 0)));
      return work;
    };
    const small = measure(100);
    const large = measure(200);
    expect(large.visits).toBeLessThan(small.visits * 3);
    expect(large.copied).toBeLessThan(small.copied * 3);
  });

  it('builds one plan and bounds actual application work when editing multiple sheets', () => {
    const sheets = ['first', 'second', 'third'].map((id) => sheetDocument({ id, name: id, cells: { A1: '1', A2: '2' } }));
    const measure = (count: number) => {
      const old = '=' + Array.from({ length: count }, (_, index) => `${index}+@A[1]`).join('+');
      const next = '=' + Array.from({ length: count }, (_, index) => `${index + count}+@A[1]`).join('-');
      const workbook = save(workbookWithSheets(sheets), old);
      const work: ReconciliationWork = { plans: 0, visits: 0, comparisons: 0, copied: 0 };
      const original = preparation.planFunctionBodyEdit;
      const spy = vi.spyOn(preparation, 'planFunctionBodyEdit').mockImplementation((text, previous, parameters, previousParameters) => original(text, previous, parameters, previousParameters, work));
      try {
        const edited = save(reorder(workbook), next, 'value');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(work.plans).toBe(1);
        for (const sheet of sheets) {
          const reference = workbook.functions![0].bodyBindings![sheet.id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/)![0];
          expect(edited.functions![0].bodyBindings![sheet.id].split(reference)).toHaveLength(count + 1);
        }
        const size = old.length + next.length + Object.values(workbook.functions![0].bodyBindings!).reduce((sum, binding) => sum + binding.length, 0);
        expect(work.visits).toBeLessThan(12 * size);
        expect(work.comparisons).toBeLessThan(20 * sheets.length * count * Math.log2(count + 1));
        expect(work.copied).toBeLessThan(20 * size);
        return work;
      } finally {
        spy.mockRestore();
      }
    };
    const small = measure(100);
    const large = measure(200);
    expect(large.visits).toBeLessThan(3 * small.visits);
    expect(large.copied).toBeLessThan(3 * small.copied);
  });

  it('does not transfer a later duplicate identity into an unmapped earlier occurrence', () => {
    const sheets = ['first', 'second'].map((id) => sheetDocument({ id, name: id, cells: { A1: '1', A2: '2' } }));
    let workbook = save(workbookWithSheets(sheets), '=@A[1]+@A[1]+@A[1]');
    const previous = workbook.functions![0];
    const bindings = Object.fromEntries(sheets.map(({ id }) => {
      const canonical = previous.bodyBindings![id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/)![0];
      return [id, requireStoredFormula(`=xxxxx+${canonical}+${canonical}`)];
    }));
    workbook = reorder({ ...workbook, functions: [{ ...previous, bodyBindings: bindings }] });
    const fresh = save({ ...workbook, functions: [] }, '=@A[1]').functions![0].bodyBindings!;
    workbook = save(workbook, '=@A[1]+@A[1]', 'value');
    for (const { id } of sheets) {
      const oldReference = previous.bodyBindings![id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/)![0];
      const freshReference = fresh[id].slice(1);
      expect(freshReference).not.toBe(oldReference);
      expect(workbook.functions![0].bodyBindings![id]).toBe(`=${freshReference}+${oldReference}`);
    }
    workbook = save(workbook, '=@A[1]+@A[1]+@A[1]', 'value');
    for (const { id } of sheets) {
      const oldReference = previous.bodyBindings![id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/)![0];
      const freshReference = fresh[id].slice(1);
      expect(workbook.functions![0].bodyBindings![id]).toBe(`=${freshReference}+${oldReference}+${freshReference}`);
    }
  });

  it('retains anchors across dissimilar valid expressions independently for each caller', () => {
    const first = sheetDocument({ id: 'first', name: 'First', cells: { A1: '2', A2: '9', B1: '4', B2: '8' } });
    const second = sheetDocument({ id: 'second', name: 'Second', cells: { A1: '3', A2: '7', B1: '5', B2: '6' } });
    const terms = (value: string) => Array(600).fill(value).join('+');
    let workbook = save(workbookWithSheets([first, second]), `=${terms('1')}+@A[1]+${terms('2')}+@B[1]`);
    const before = workbook.functions![0].bodyBindings!;
    workbook = reorder(workbook);
    workbook = save(workbook, `=${terms('3')}+@A[1]+${terms('4')}+@B[2]`, 'value');
    const fresh = save({ ...workbook, functions: [] }, '=@B[2]').functions![0].bodyBindings!;
    for (const id of ['first', 'second']) {
      const oldRefs = before[id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/g)!;
      const refs = workbook.functions![0].bodyBindings![id].match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/g)!;
      expect(refs[0]).toBe(oldRefs[0]);
      expect(refs[1]).toBe(fresh[id].slice(1));
    }
  });

  it('retains lexed references in dissimilar malformed source and ignores quoted lookalikes', () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', cells: { A1: '1', A2: '2', B1: '3', B2: '4' } });
    let workbook = save(workbookWithSheets([sheet]), `=${'x+'.repeat(1000)}@A[1]+@B[1]+"@A[1]"+`);
    const before = workbook.functions![0].bodyBindings!.first.match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/g)!.slice(0, 2);
    workbook = reorder(workbook);
    workbook = save(workbook, `=${'y-'.repeat(1000)}@B[1]+@A[1]+"@A[1]"+`, 'value');
    expect(workbook.functions![0].bodyBindings!.first.match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/g)!.slice(0, 2)).toEqual([before[1], before[0]]);
    workbook = save(workbook, '=@A[1]+@B[1]', 'value');
    expect(workbook.functions![0].bodyBindings!.first.match(/@[a-zA-Z0-9:]+\[[a-zA-Z0-9:]+\]/g)).toEqual(before);
  });
});
