import { describe, expect, it } from 'vitest';
import { validationMessage } from './sheetValidationMessage';

describe('sheet validation feedback', () => {
  it.each([
    ['empty', 'Sheet name is required.'],
    ['duplicate', 'A sheet with that name already exists.'],
    ['unknown-sheet', 'The target sheet could not be found.'],
    ['pending-model-transition', 'Wait for the data model change to finish.'],
    ['pending-axis-creation', 'Wait for row or column creation to finish.'],
    ['pending-sheet-creation', 'Wait for sheet creation to finish.'],
    ['blocked-persistence-prerequisite', 'Retry failed saves before renaming the sheet.'],
    ['persistence-failed', 'Saving failed. Retry or recover the failed saves before renaming the sheet.'],
    ['sorting-history-too-large', 'This rename would create sorting history that is too large to save.'],
  ] as const)('explains %s', (reason, message) => {
    expect(validationMessage(reason)).toBe(message);
  });
});
