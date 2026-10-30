import type { FormulaSourceSpan } from './syntax';

export type OpaqueFormulaText = FormulaSourceSpan & { text: string };

/** UTF-16 units agree with the JVM, including unpaired surrogates. */
export function escapeFormulaText(text: string): string {
  return `~{${Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16).padStart(4, '0')).join('')}}`;
}

/** Quoted formula literals never participate in the internal escape grammar. */
export function opaqueFormulaText(content: string): OpaqueFormulaText[] {
  const spans: OpaqueFormulaText[] = [];
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '"') {
      if (quoted && content[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && content.startsWith('~{', index)) {
      const end = content.indexOf('}', index + 2);
      const hex = content.slice(index + 2, end);
      if (end < 0 || !/^(?:[0-9a-f]{4})+$/.test(hex)) throw new Error('Invalid stored formula');
      const text = hex.replace(/.{4}/g, (unit) => String.fromCharCode(parseInt(unit, 16)));
      spans.push({ start: index, end: end + 1, text });
      index = end;
    }
  }
  return spans;
}

export function maskOpaqueFormulaText(content: string): string {
  return opaqueFormulaText(content).reduceRight((text, span) => text.slice(0, span.start) + '#REF!'.padEnd(span.end - span.start) + text.slice(span.end), content);
}
