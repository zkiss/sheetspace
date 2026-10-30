import type { StoredFormulaContent } from '../core/storedFormulaContent';
import { opaqueFormulaText } from './opaqueFormulaText';
export type { StoredFormulaContent } from '../core/storedFormulaContent';

/** Only trusted storage boundaries call this; fresh user text must be prepared. */
export function requireStoredFormula(content: string): StoredFormulaContent {
  if (!content.startsWith('=')) throw new Error('Invalid stored formula');
  opaqueFormulaText(content);
  return content as StoredFormulaContent;
}
