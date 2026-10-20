type SourceSpan = { start: number; end: number };
type TemplateEndpoint = {
  sourceSpan: SourceSpan;
  columnId: string;
  rowIndex: number;
  anchors: { row: boolean; column: boolean };
  propertyId?: string;
};

/** Sheet-specific stable columns and positional rows for a declaration's row-1 template. */
export type BoundModelFormula = {
  raw: string;
  references: {
    sourceSpan: SourceSpan;
    sheetId?: string;
    qualifierSpan?: SourceSpan;
    endpoints: (TemplateEndpoint | null)[];
  }[];
};
export type ModelFormulaBindings = Readonly<Record<string, BoundModelFormula>>;
