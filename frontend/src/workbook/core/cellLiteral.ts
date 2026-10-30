export function encodeCellTextLiteral(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

export function decodeCellTextLiteral(raw: string): string | undefined {
  if (!/^"(?:[^"]|"")*"$/s.test(raw)) return undefined;
  return raw.slice(1, -1).replace(/""/g, '"');
}
