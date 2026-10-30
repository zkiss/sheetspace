import { describe, expect, it } from 'vitest';
import fixtures from '../../../../test-fixtures/stored-formula-contract.json';
import { decodeStoredFormula, encodeStoredFormula, type StoredFormula } from './storedFormula';

describe('stored formula contract', () => {
  it.each(fixtures.valid)('round trips $name with exact cross-language bytes', ({ content, text }) => {
    const formula = decodeStoredFormula(content);
    expect(formula.text).toBe(text);
    expect(encodeStoredFormula(formula)).toBe(content);
  });

  it.each(fixtures.invalid)('rejects invalid stored content %s without a literal fallback', (content) => {
    expect(() => decodeStoredFormula(content)).toThrow('Invalid stored formula');
  });

  it('retains dead targets and malformed dormant provenance without workbook lookups', () => {
    const formula = decodeStoredFormula(fixtures.valid[4].content);
    expect(formula.occurrences[0].slots[0].targetIds).toEqual(['sheet-dead']);
    expect(formula.occurrences[1].slots[2]).toMatchObject({ key: 1, status: 'retained', targetIds: ['row2-dead'] });
    expect(formula.text).toContain('B[0]');
  });

  it('rejects invalid in-memory metadata before JSON can coerce it', () => {
    const formula = boundFormula();
    formula.occurrences[0].slots[1].key = NaN;
    expect(() => encodeStoredFormula(formula)).toThrow('Invalid stored formula');
    formula.occurrences[0].slots[1].key = Infinity;
    expect(() => encodeStoredFormula(formula)).toThrow('Invalid stored formula');
  });

  it.each(invalidMutations())('rejects $name', ({ path, value }) => {
    const payload: unknown = JSON.parse(fixtures.valid[4].content.slice(4));
    expect(() => decodeStoredFormula('=~F1' + JSON.stringify(replaceAt(payload, path, value)))).toThrow('Invalid stored formula');
  });

  it('preserves endpoint ordering and independent anchors for a range', () => {
    const formula = boundFormula();
    const occurrence = formula.occurrences[0];
    occurrence.slots.push({ id: 'c2', kind: 'column', key: 1, status: 'unresolved', targetIds: [] },
      { id: 'r2', kind: 'row', key: 2, status: 'unresolved', targetIds: [] });
    occurrence.endpoints.push({ id: 'e2', columnSlotId: 'c2', rowSlotId: 'r2', anchors: { column: true, row: false } });
    expect(decodeStoredFormula(encodeStoredFormula(formula))).toEqual(formula);
  });

  it('does not allow endpoint slots to alias another endpoint', () => {
    const formula = boundFormula();
    const occurrence = formula.occurrences[0];
    occurrence.endpoints.push({ ...occurrence.endpoints[0], id: 'e2' });
    expect(() => encodeStoredFormula(formula)).toThrow('Invalid stored formula');
  });

  it('normalizes JSON whitespace and numeric spelling without reordering occurrence identity', () => {
    const content = fixtures.valid[4].content;
    const formula = decodeStoredFormula(content.replace(',0,"retained"', ',0.0,"retained"').replace('=~F1[', '=~F1 [ '));
    expect(formula).toEqual(boundFormula());
    expect(encodeStoredFormula(formula)).toBe(content);
  });
});

function boundFormula(): StoredFormula { return decodeStoredFormula(fixtures.valid[4].content); }

function replaceAt(payload: unknown, path: number[], value: unknown): unknown {
  if (path.length === 0) return value;
  if (!Array.isArray(payload)) throw new Error('Invalid test mutation');
  return payload.map((child, index) => index === path[0] ? replaceAt(child, path.slice(1), value) : child);
}

function invalidMutations(): { name: string; path: number[]; value: unknown }[] {
  const endpoint = ['e', 'c', 'r', false, false];
  return [
    { name: 'non-array occurrence', path: [1, 0], value: {} },
    { name: 'extra occurrence member', path: [1, 0], value: ['x', [1, 10], 's', [], [], [], 0] },
    { name: 'blank occurrence ID', path: [1, 0, 0], value: ' ' },
    { name: 'numeric occurrence ID', path: [1, 0, 0], value: 0 },
    { name: 'negative guard', path: [1, 0, 1, 0], value: -1 },
    { name: 'fractional guard', path: [1, 0, 1, 0], value: 0.5 },
    { name: 'string guard', path: [1, 0, 1, 0], value: '1' },
    { name: 'empty guard', path: [1, 0, 1, 1], value: 1 },
    { name: 'out of bounds guard', path: [1, 1, 1, 1], value: 25 },
    { name: 'overlapping guards', path: [1, 1, 1, 0], value: 9 },
    { name: 'duplicate occurrence ID', path: [1, 1, 0], value: 'x' },
    { name: 'missing sheet slot', path: [1, 0, 2], value: 'absent' },
    { name: 'non-sheet effective slot', path: [1, 0, 2], value: 'c' },
    { name: 'extra endpoint member', path: [1, 0, 3, 0], value: [...endpoint, 0] },
    { name: 'string anchor', path: [1, 0, 3, 0, 3], value: 'true' },
    { name: 'null anchor', path: [1, 0, 3, 0, 4], value: null },
    { name: 'duplicate endpoint IDs', path: [1, 0, 3], value: [endpoint, endpoint] },
    { name: 'too many endpoints', path: [1, 0, 3], value: [endpoint, ['e2', 'c', 'r', false, false], ['e3', 'c', 'r', false, false]] },
    { name: 'wrong column slot kind', path: [1, 0, 3, 0, 1], value: 'r' },
    { name: 'wrong row slot kind', path: [1, 0, 3, 0, 2], value: 'c' },
    { name: 'absent column slot', path: [1, 0, 3, 0, 1], value: 'missing' },
    { name: 'duplicate slot ID', path: [1, 0, 4, 1, 0], value: 's' },
    { name: 'unknown slot kind', path: [1, 0, 4, 0, 1], value: 'expression' },
    { name: 'unknown slot status', path: [1, 0, 4, 0, 3], value: 'fresh' },
    { name: 'non-string sheet key', path: [1, 0, 4, 0, 2], value: 3 },
    { name: 'non-string property key', path: [1, 0, 4, 1], value: ['c', 'property', 0, 'retained', ['column']] },
    { name: 'negative column key', path: [1, 0, 4, 1, 2], value: -1 },
    { name: 'fractional column key', path: [1, 0, 4, 1, 2], value: 1.5 },
    { name: 'string row key', path: [1, 0, 4, 2, 2], value: '1' },
    { name: 'zero row key', path: [1, 0, 4, 2, 2], value: 0 },
    { name: 'unsafe row key', path: [1, 0, 4, 2, 2], value: 9007199254740992 },
    { name: 'object key', path: [1, 0, 4, 2, 2], value: {} },
    { name: 'missing retained ID', path: [1, 0, 4, 0, 4], value: [] },
    { name: 'unexpected unresolved ID', path: [1, 0, 4, 0, 3], value: 'unresolved' },
    { name: 'wrong property identity tuple', path: [1, 0, 4, 1], value: ['c', 'property', 'A', 'retained', ['column']] },
    { name: 'blank retained ID', path: [1, 0, 4, 0, 4, 0], value: '' },
    { name: 'dangling origin', path: [1, 0, 5, 0, 2], value: 'missing' },
    { name: 'origin before guard', path: [1, 0, 5, 0, 0], value: 0 },
    { name: 'origin after guard', path: [1, 0, 5, 6, 1], value: 11 },
    { name: 'inverted origin', path: [1, 0, 5, 0, 0], value: 3 },
    { name: 'overlapping origins', path: [1, 0, 5, 1, 0], value: 1 },
    { name: 'duplicate markers', path: [1, 0, 5], value: [[1, 1, null], [1, 1, null]] },
    { name: 'unsorted marker IDs', path: [1, 0, 5], value: [[1, 1, 's'], [1, 1, 'r']] },
    { name: 'structural marker after payload marker', path: [1, 0, 5], value: [[1, 1, 's'], [1, 1, null]] },
  ];
}
