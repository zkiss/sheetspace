import type { FormulaDiagnostic } from './syntaxTypes';

export function syntaxDiagnostic(input: string, start: number, end: number): FormulaDiagnostic {
  if (input.length === 0) {
    return { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: 0, end: 1 } };
  }
  const boundedStart = Math.min(Math.max(start, 0), input.length - 1);
  const boundedEnd = Math.min(Math.max(end, boundedStart + 1), input.length);
  return { kind: 'syntax', code: '#PARSE!', sourceSpan: { start: boundedStart + 1, end: boundedEnd + 1 } };
}
