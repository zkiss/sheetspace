import type { FormulaSyntaxToken } from './syntaxTypes';

export function skipFormulaTextLiteral(input: string, start: number): number {
  let index = start + 1;
  while (index < input.length) {
    if (input[index] !== '"') index++;
    else if (input[index + 1] === '"') index += 2;
    else return index + 1;
  }
  return index;
}

/** Fill parser-unrecognised fragments without changing recognised tokens. */
export function completeFormulaTokens(raw: string, tokens: readonly FormulaSyntaxToken[]): FormulaSyntaxToken[] {
  const selected = [...tokens]
    .sort((left, right) => left.sourceSpan.start - right.sourceSpan.start || right.sourceSpan.end - left.sourceSpan.end)
    .filter((token, index, tokens) => !tokens.slice(0, index).some((prior) => prior.sourceSpan.start < token.sourceSpan.end && token.sourceSpan.start < prior.sourceSpan.end));
  const complete: FormulaSyntaxToken[] = []; let cursor = 0;
  for (const token of selected) {
    if (cursor < token.sourceSpan.start) complete.push({ kind: 'invalid', sourceSpan: { start: cursor, end: token.sourceSpan.start } });
    complete.push(token);
    cursor = token.sourceSpan.end;
  }
  if (cursor < raw.length) complete.push({ kind: 'invalid', sourceSpan: { start: cursor, end: raw.length } });
  return complete;
}
