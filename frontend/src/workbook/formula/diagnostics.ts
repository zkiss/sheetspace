import type { FormulaDiagnostic } from './syntaxTypes';

/**
 * The shared analysis has one diagnostic ordering boundary.  Producers retain
 * their source-specific responsibility; callers receive a deterministic,
 * de-duplicated document-order result.
 */
export function mergeFormulaDiagnostics(
  ...groups: readonly (readonly FormulaDiagnostic[])[]
): FormulaDiagnostic[] {
  return groups
    .flatMap((group) => group)
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort(({ diagnostic: left, index: leftIndex }, { diagnostic: right, index: rightIndex }) =>
      left.sourceSpan.start - right.sourceSpan.start
      || left.sourceSpan.end - right.sourceSpan.end
      || diagnosticKindPriority(left) - diagnosticKindPriority(right)
      || leftIndex - rightIndex)
    .filter(({ diagnostic }, index, diagnostics) =>
      index === 0
      || diagnostics[index - 1]!.diagnostic.sourceSpan.start !== diagnostic.sourceSpan.start
      || diagnostics[index - 1]!.diagnostic.sourceSpan.end !== diagnostic.sourceSpan.end)
    .map(({ diagnostic }) => diagnostic);
}

function diagnosticKindPriority(diagnostic: FormulaDiagnostic): number {
  return diagnostic.kind === 'syntax' ? 0 : 1;
}
