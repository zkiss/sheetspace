import type { Workbook } from '../core/model';
import { formulaRawToDisplay, workbookFormulaReferenceResolver } from './reference';
import { opaqueFormulaText } from './opaqueFormulaText';
import { analyzeStoredFormula, type StoredFormulaAnalysis } from './storedFormulaAnalysis';
import type { FormulaSourceSpan } from './syntax';

export type StoredFormulaProjection = {
  text: string;
  references: { sourceSpan: FormulaSourceSpan; displaySpan: FormulaSourceSpan }[];
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
  let text = '', cursor = 0;
  for (const edit of edits) {
    text += content.slice(cursor, edit.start);
    const start = text.length;
    text += edit.text;
    if (edit.reference) references.push({ sourceSpan: { start: edit.start, end: edit.end }, displaySpan: { start, end: text.length } });
    cursor = edit.end;
  }
  return { text: text + content.slice(cursor), references, analysis };
}
