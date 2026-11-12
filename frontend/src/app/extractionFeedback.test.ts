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

  it('explains how to resolve sorted extraction undo capacity rejection', () => {
    expect(extractionFeedback({ ok: false, reason: 'sorting-history-too-large' })).toBe(
      'This extraction is too large to undo while sorting is active. Select a smaller range or clear sorting and try again. No cells were changed.',
    );
  });

  it('ignores successful and absent results', () => {
    expect(extractionFeedback({ ok: true })).toBeUndefined();
    expect(extractionFeedback(undefined)).toBeUndefined();
    expect(extractionFeedback({ ok: false })).toBe('The extraction was not applied.');
  });
});
