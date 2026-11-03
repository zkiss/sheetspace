import { describe, expect, it } from 'vitest';
import { extractionFeedback } from './extractionFeedback';

describe('extraction feedback', () => {
  it.each([
    ['unrepresentable-range', 'entire referenced range'],
    ['protected-source', 'unbound sheet'],
    ['protected-model-formula', 'model formula'],
    ['invalid-selection', 'Select saved cells'],
    ['unknown-source', 'Select saved cells'],
    ['extraction-history-too-large', 'smaller range'],
    ['pending', 'pending'],
  ])('explains %s failures', (reason, explanation) => {
    expect(extractionFeedback({ ok: false, reason })).toContain(explanation);
  });

  it('ignores successful and absent results', () => {
    expect(extractionFeedback({ ok: true })).toBeUndefined();
    expect(extractionFeedback(undefined)).toBeUndefined();
    expect(extractionFeedback({ ok: false })).toBe('The extraction was not applied.');
  });
});
