import { expect, it } from 'vitest';
import { validLifecycleFunctions } from './lifecycleFunctionValidation';

it('validates large function sets and rejects case-insensitive duplicates at the end', () => {
  const functions = Array.from({ length: 3000 }, (_, index) => ({
    identity: `identity-${index}`, name: `function${index}`, parameters: [], body: 'x'.repeat(1000),
  }));
  expect(validLifecycleFunctions(functions)).toBe(true);
  expect(validLifecycleFunctions([...functions, { ...functions[0]!, identity: 'other', name: 'FUNCTION0' }])).toBe(false);
  expect(validLifecycleFunctions([...functions, { ...functions[0]!, name: 'other' }])).toBe(false);
  expect(validLifecycleFunctions([...functions, { ...functions[0]!, identity: 'other', name: 'SUM' }])).toBe(false);
});
