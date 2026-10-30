import { describe, expect, it } from 'vitest';
import fixtures from '../../../../test-fixtures/stored-formula-contract.json';
import { escapeFormulaText, opaqueFormulaText } from './opaqueFormulaText';
import { requireStoredFormula } from './storedFormula';

describe('inline stored formula contract', () => {
  it('shares opaque text round trips with the backend', () => {
    for (const { content, fragments } of fixtures.valid) {
      expect(requireStoredFormula(content)).toBe(content);
      expect(opaqueFormulaText(content).map(({ text }) => text)).toEqual(fragments);
      for (const fragment of fragments) {
        expect(opaqueFormulaText(`=${escapeFormulaText(fragment)}`)[0].text).toBe(fragment);
      }
    }
  });

  it('rejects malformed stored formulas', () => {
    for (const content of fixtures.invalid) expect(() => requireStoredFormula(content)).toThrow();
  });
});
