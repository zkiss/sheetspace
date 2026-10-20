/** Reserved storage envelope; its payload is text, never spreadsheet input. */
const TEXT_LITERAL_PREFIX = '\u001eSheetspace:text:';

export function encodeCellTextLiteral(text: string): string {
  return TEXT_LITERAL_PREFIX + JSON.stringify(text);
}

export function decodeCellTextLiteral(raw: string): string | undefined {
  if (!raw.startsWith(TEXT_LITERAL_PREFIX)) return undefined;
  try {
    const value: unknown = JSON.parse(raw.slice(TEXT_LITERAL_PREFIX.length));
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
