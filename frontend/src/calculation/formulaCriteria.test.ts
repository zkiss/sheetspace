import { describe, expect, it } from 'vitest';
import {
  matchFormulaCriterion,
  parseFormulaCriterion,
  type FormulaCriterion,
} from '@calculation/formulaCriteria';
import type { FormulaScalarValue } from '@calculation/formulaValue';

describe('conditional aggregate criteria', () => {
  it.each([
    [{ kind: 'number', value: 10 }, '=', { kind: 'number', value: 10 }],
    [{ kind: 'boolean', value: true }, '=', { kind: 'boolean', value: true }],
    [{ kind: 'blank' }, '=', { kind: 'blank' }],
    [{ kind: 'text', value: '>=10' }, '>=', { kind: 'number', value: 10 }],
    [{ kind: 'text', value: '<>FALSE' }, '<>', { kind: 'boolean', value: false }],
    [{ kind: 'text', value: 'open' }, '=', { kind: 'text', value: 'open' }],
    [{ kind: 'text', value: '==open' }, '=', { kind: 'text', value: '=open' }],
    [{ kind: 'text', value: '=01.0e1' }, '=', { kind: 'number', value: 10 }],
    [{ kind: 'text', value: ' true' }, '=', { kind: 'text', value: ' true' }],
    [{ kind: 'text', value: 'TrUe' }, '=', { kind: 'boolean', value: true }],
  ] as const)(
    'parses evaluated literal/reference criterion %j',
    (input, operator, operand) => {
      expect(parseFormulaCriterion(input)).toEqual({
        ok: true,
        value: { operator, operand },
      });
    },
  );

  it.each([
    ['="10"', '10'],
    ['="say ""hi"""', 'say "hi"'],
    ['=""', ''],
    ['="="', '='],
  ])('parses forced-text criterion %s', (input, expected) => {
    expect(parseFormulaCriterion({ kind: 'text', value: input })).toEqual({
      ok: true,
      value: { operator: '=', operand: { kind: 'text', value: expected } },
    });
  });

  it('keeps empty text distinct from blank while supporting explicit blank operators', () => {
    expect(parseFormulaCriterion({ kind: 'text', value: '' })).toEqual({
      ok: true,
      value: { operator: '=', operand: { kind: 'text', value: '' } },
    });
    expect(parseFormulaCriterion({ kind: 'text', value: '=' })).toEqual({
      ok: true,
      value: { operator: '=', operand: { kind: 'blank' } },
    });
    expect(parseFormulaCriterion({ kind: 'text', value: '<>' })).toEqual({
      ok: true,
      value: { operator: '<>', operand: { kind: 'blank' } },
    });
  });

  it.each(['<', '<=', '>', '>=', '="unterminated', '="ok"trailing'])(
    'rejects invalid criterion %s',
    (input) => {
      expect(parseFormulaCriterion({ kind: 'text', value: input })).toEqual({
        ok: false,
        error: '#VALUE!',
      });
    },
  );

  it('propagates an upstream criterion error', () => {
    expect(parseFormulaCriterion({ kind: 'error', error: '#REF!' })).toEqual({
      ok: false,
      error: '#REF!',
    });
  });

  it.each([
    ['=', 0, true],
    ['=', -1, false],
    ['<>', -1, true],
    ['<>', 0, false],
    ['<', -1, true],
    ['<', 0, false],
    ['<=', 0, true],
    ['<=', 1, false],
    ['>', 1, true],
    ['>', 0, false],
    ['>=', 0, true],
    ['>=', -1, false],
  ] as const)('applies numeric operator %s at comparison %s', (operator, delta, expected) => {
    const criterion: FormulaCriterion = {
      operator,
      operand: { kind: 'number', value: 10 },
    };
    expect(matchFormulaCriterion(criterion, { kind: 'number', value: 10 + delta })).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [{ operator: '<', operand: { kind: 'text', value: 'a' } }, { kind: 'text', value: 'A' }, true],
    [{ operator: '>', operand: { kind: 'text', value: '\u{E000}' } }, { kind: 'text', value: '\u{10000}' }, true],
    [{ operator: '<', operand: { kind: 'boolean', value: true } }, { kind: 'boolean', value: false }, true],
    [{ operator: '>=', operand: { kind: 'boolean', value: true } }, { kind: 'boolean', value: true }, true],
  ] as const)('shares scalar ordering for %j', (criterion, candidate, expected) => {
    expect(matchFormulaCriterion(criterion, candidate)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [{ operator: '=', operand: { kind: 'blank' } }, { kind: 'blank' }, true],
    [{ operator: '=', operand: { kind: 'blank' } }, { kind: 'text', value: '' }, false],
    [{ operator: '<>', operand: { kind: 'blank' } }, { kind: 'blank' }, false],
    [{ operator: '<>', operand: { kind: 'blank' } }, { kind: 'number', value: 0 }, true],
    [{ operator: '<>', operand: { kind: 'blank' } }, { kind: 'boolean', value: false }, true],
    [{ operator: '<>', operand: { kind: 'blank' } }, { kind: 'text', value: '' }, true],
  ] as const)('matches blank criterion %j', (criterion, candidate, expected) => {
    expect(matchFormulaCriterion(criterion, candidate)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [{ operator: '=', operand: { kind: 'number', value: 10 } }, { kind: 'text', value: '10' }],
    [{ operator: '<>', operand: { kind: 'number', value: 10 } }, { kind: 'text', value: '11' }],
    [{ operator: '>', operand: { kind: 'boolean', value: false } }, { kind: 'number', value: 1 }],
    [{ operator: '<', operand: { kind: 'text', value: 'z' } }, { kind: 'blank' }],
  ] as const)('returns a no-match result for category mismatch %j', (criterion, candidate) => {
    expect(matchFormulaCriterion(criterion, candidate)).toEqual({ ok: true, value: false });
  });

  it('propagates an error candidate instead of treating it as no-match', () => {
    const criterion: FormulaCriterion = {
      operator: '=',
      operand: { kind: 'number', value: 10 },
    };
    expect(matchFormulaCriterion(criterion, { kind: 'error', error: '#DIV/0!' })).toEqual({
      ok: false,
      error: '#DIV/0!',
    });
  });

  it('matches deterministically across materialized cell and range values', () => {
    const parsed = parseFormulaCriterion({ kind: 'text', value: '>=10' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const values: FormulaScalarValue[] = [
      { kind: 'number', value: 9 },
      { kind: 'number', value: 10 },
      { kind: 'text', value: '10' },
      { kind: 'number', value: 11 },
    ];
    expect(values.map((value) => matchFormulaCriterion(parsed.value, value))).toEqual([
      { ok: true, value: false },
      { ok: true, value: true },
      { ok: true, value: false },
      { ok: true, value: true },
    ]);
  });
});
