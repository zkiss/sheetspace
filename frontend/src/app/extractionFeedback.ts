export function extractionFeedback(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok) return undefined;
  const reason = 'reason' in result ? String(result.reason) : '';
  switch (reason) {
    case 'unrepresentable-range':
      return 'Extraction would split a referenced range. Select the entire referenced range or change the formula and try again. No cells were changed.';
    case 'protected-source':
      return 'This sheet is bound to a data model. Extract from an unbound sheet instead. No cells were changed.';
    case 'protected-model-formula':
      return 'Extraction would change a protected data model formula. Change the selection or the model formula and try again. No cells were changed.';
    case 'invalid-selection':
    case 'unknown-source':
      return 'The selection is no longer available. Select saved cells, rows, or columns and try again.';
    case 'extraction-history-too-large':
      return 'This extraction is too large to undo. Select a smaller range and try again. No cells were changed.';
    default:
      return `The extraction was not applied${reason ? `: ${reason}` : ''}.`;
  }
}
