import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { insertExtractionStacking } from './extractionStacking';

function sheet(id: string, zIndex: number) {
  const result = sheetDocument({ id, name: id, rowCount: 1, columnCount: 1 });
  result.frame.zIndex = zIndex;
  return result;
}

function effective(ids: string[], values: number[]) {
  return ids.map((id, rank) => ({ id, rank, z: values[rank]! }))
    .sort((a, b) => a.z - b.z || a.rank - b.rank).map(({ id }) => id);
}

function minimumChanges(old: number[], source: number) {
  const ids = old.map((_, i) => `s${i}`).concat('target');
  const desired = effective(ids.slice(0, -1), old);
  desired.splice(desired.indexOf(`s${source}`) + 1, 0, 'target');
  let minimum = Infinity;
  const visit = (values: number[]) => {
    if (values.length === ids.length) {
      if (effective(ids, values).join() === desired.join()) {
        minimum = Math.min(minimum, old.filter((z, i) => z !== values[i]).length);
      }
      return;
    }
    for (let z = 1; z <= 6; z++) visit([...values, z]);
  };
  visit([]);
  return { desired, minimum };
}

describe('optimal extraction stacking', () => {
  it('leaves higher tied neighbors and an unrelated frame unchanged when the target can tie the source', () => {
    const sheets = [1, 2, 2, 4].map((z, i) => sheet(`s${i}`, z));
    const result = insertExtractionStacking(workbookWithSheets(sheets), 's0', sheet('target', 99));
    expect(sheets.map(({ id }) => result.documents[id]!.frame.zIndex)).toEqual([1, 2, 2, 4]);
    expect(result.documents.target!.frame.zIndex).toBe(1);
  });

  it('minimizes changed frames against an independent exhaustive oracle', () => {
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 3; c++) {
      const old = [a, b, c];
      for (let source = 0; source < old.length; source++) {
        const sheets = old.map((z, i) => sheet(`s${i}`, z));
        const workbook = workbookWithSheets(sheets), before = structuredClone(workbook);
        const result = insertExtractionStacking(workbook, `s${source}`, sheet('target', 99));
        const ids = [...old.map((_, i) => `s${i}`), 'target'];
        const values = ids.map((id) => result.documents[id]!.frame.zIndex);
        const oracle = minimumChanges(old, source);
        expect(effective(ids, values)).toEqual(oracle.desired);
        expect(old.filter((z, i) => z !== values[i])).toHaveLength(oracle.minimum);
        expect(workbook).toEqual(before);
      }
    }
  });

  it.each([
    [[1, 2, 2, 4], 0], [[2147483647, 2147483647, 2147483646], 0],
    [[1, 1, 2], 0], [[2147483647], 0], [[3, 1, 2], 1],
  ])('preserves effective order and bounds for %s', (old, source) => {
    const sheets = old.map((z, i) => sheet(`s${i}`, z));
    const ids = sheets.map(({ id }) => id);
    const desired = effective(ids, old);
    desired.splice(desired.indexOf(`s${source}`) + 1, 0, 'target');
    const result = insertExtractionStacking(workbookWithSheets(sheets), `s${source}`, sheet('target', 1));
    const all = [...ids, 'target'];
    const values = all.map((id) => result.documents[id]!.frame.zIndex);
    expect(effective(all, values)).toEqual(desired);
    expect(values.every((z) => Number.isInteger(z) && z >= 1 && z <= 2147483647)).toBe(true);
  });
});
