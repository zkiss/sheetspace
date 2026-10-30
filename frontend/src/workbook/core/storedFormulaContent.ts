declare const storedFormulaContent: unique symbol;
export type StoredFormulaContent = string & { readonly [storedFormulaContent]: true };
