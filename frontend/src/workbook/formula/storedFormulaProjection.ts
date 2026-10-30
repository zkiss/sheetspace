import type { Workbook } from '../core/model';
import { formulaRawToDisplay, workbookFormulaReferenceResolver } from './reference';
import { opaqueFormulaText } from './opaqueFormulaText';
import { analyzeStoredFormula, type StoredFormulaAnalysis } from './storedFormulaAnalysis';
import type { FormulaSourceSpan } from './syntax';

export type StoredFormulaProjection = {
  text: string;
  references: { sourceSpan: FormulaSourceSpan; displaySpan: FormulaSourceSpan }[];
  displaySpan: (span: FormulaSourceSpan) => FormulaSourceSpan;
  analysis: StoredFormulaAnalysis;
};

export function projectStoredFormula(content: string, workbook: Workbook, currentSheetId = ''): StoredFormulaProjection {
  const analysis = analyzeStoredFormula(content, workbook, currentSheetId);
  const resolver = workbookFormulaReferenceResolver(workbook, currentSheetId);
  const edits = [
    ...opaqueFormulaText(content).map((span) => ({ ...span, reference: false })),
    ...analysis.references.filter(({ reference }) => reference).map(({ lexeme }) => ({
      ...lexeme.sourceSpan, text: formulaRawToDisplay(`=${content.slice(lexeme.sourceSpan.start, lexeme.sourceSpan.end)}`, resolver).slice(1), reference: true,
    })),
  ].sort((left, right) => left.start - right.start);
  const references: StoredFormulaProjection['references'] = [];
  const mappings: StoredFormulaProjection['references'] = [];
  let text = '', cursor = 0;
  for (const edit of edits) {
    text += content.slice(cursor, edit.start);
    const start = text.length;
    text += edit.text;
    mappings.push({ sourceSpan: { start: edit.start, end: edit.end }, displaySpan: { start, end: text.length } });
    if (edit.reference) references.push({ sourceSpan: { start: edit.start, end: edit.end }, displaySpan: { start, end: text.length } });
    cursor = edit.end;
  }
  const position = (offset: number, end: boolean) => {
    let shift = 0;
    for (const mapping of mappings) {
      if (offset < mapping.sourceSpan.start) break;
      if (offset < mapping.sourceSpan.end) return end ? mapping.displaySpan.end : mapping.displaySpan.start;
      shift = mapping.displaySpan.end - mapping.sourceSpan.end;
    }
    return offset + shift;
  };
  return { text: text + content.slice(cursor), references, analysis, displaySpan: (span) => ({ start: position(span.start, false), end: position(span.end, true) }) };
}
