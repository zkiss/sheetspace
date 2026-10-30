import type { StoredFormulaContent } from './storedFormulaContent';

export type BoundModelFormula = { content: StoredFormulaContent };
export type ModelFormulaBindings = Readonly<Record<string, BoundModelFormula>>;
