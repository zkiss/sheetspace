import type { RenameSheetResult } from '@application/react/workbookControllerTypes';

type FailureReason = Extract<RenameSheetResult, { ok: false }>['reason'];

export function validationMessage(reason: FailureReason): string {
  switch (reason) {
    case 'empty': return 'Sheet name is required.';
    case 'duplicate': return 'A sheet with that name already exists.';
    case 'unknown-sheet': return 'The target sheet could not be found.';
    case 'pending-model-transition': return 'Wait for the data model change to finish.';
    case 'pending-axis-creation': return 'Wait for row or column creation to finish.';
    case 'pending-sheet-creation': return 'Wait for sheet creation to finish.';
    case 'blocked-persistence-prerequisite': return 'Retry failed saves before renaming the sheet.';
    case 'persistence-failed': return 'Saving failed. Retry or recover the failed saves before renaming the sheet.';
    case 'sorting-history-too-large': return 'This rename would create sorting history that is too large to save.';
  }
}
