import { cellIdentityKey } from '../core/cellIdentity';
import type { SheetDocument, Workbook } from '../core/model';
import type { BoundModelFormula, ModelFormulaBindings } from '../core/modelFormula';
import { formatCanonicalFormulaEndpoint, formulaReferenceTokens, workbookFormulaReferenceResolver, type FormulaAxisAnchor, type FormulaReferenceEndpoint, type FormulaSourceSpan } from './reference';

type TemplateEndpoint = {
  sourceSpan: FormulaSourceSpan;
  columnId: string;
  rowIndex: number;
  anchors: FormulaAxisAnchor;
  propertyId?: string;
};

export function bindModelFormula(raw: string, workbook: Workbook, sheetId: string): BoundModelFormula {
  const resolver = workbookFormulaReferenceResolver(workbook, sheetId);
  return {
    raw,
    references: formulaReferenceTokens(raw, resolver).map((reference) => {
      const targetId = reference.qualifier.kind === 'unqualified' ? sheetId
        : reference.qualifier.kind === 'explicit' ? resolver.sheetByQualifier(reference.qualifier.sheetId) : undefined;
      return {
        sourceSpan: reference.sourceSpan,
        sheetId: targetId,
        ...(reference.qualifier.kind === 'explicit' ? { qualifierSpan: reference.qualifier.sourceSpan } : {}),
        endpoints: reference.endpoints.filter((endpoint) => endpoint !== undefined)
          .map((endpoint) => (targetId ? bindEndpoint(endpoint, workbook, targetId) : undefined) ?? null),
      };
    }),
  };
}

function bindEndpoint(endpoint: FormulaReferenceEndpoint, workbook: Workbook, sheetId: string): TemplateEndpoint | undefined {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return undefined;
  const base = { sourceSpan: endpoint.sourceSpan, anchors: endpoint.anchors };
  if (endpoint.kind === 'a1') {
    const columnId = sheet.content.columns[endpoint.address.columnIndex];
    return columnId ? { ...base, columnId, rowIndex: endpoint.address.rowIndex } : undefined;
  }
  if (endpoint.kind === 'named') {
    const property = (sheet.modelId ? workbook.dataModels?.[sheet.modelId] : undefined)?.columns.find((column) => column.name === endpoint.propertyName);
    const columnId = property && sheet.modelColumnBindings?.[property.id];
    return property && columnId && sheet.content.columns.includes(columnId) && Number.isFinite(endpoint.row)
      ? { ...base, columnId, rowIndex: endpoint.row - 1, propertyId: property.id } : undefined;
  }
  const rowIndex = sheet.content.rows.indexOf(endpoint.coordinate.rowId);
  return rowIndex >= 0 && sheet.content.columns.includes(endpoint.coordinate.columnId)
    ? { ...base, columnId: endpoint.coordinate.columnId, rowIndex, ...(endpoint.propertyId ? { propertyId: endpoint.propertyId } : {}) } : undefined;
}

export function bindModelFormulas(workbook: Workbook, sheetId: string): ModelFormulaBindings {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  return Object.fromEntries((model?.columns ?? []).flatMap((property) => property.kind === 'calculated'
    ? [[property.id, bindModelFormula(property.formula, workbook, sheetId)]] : []));
}

export function instantiateModelFormula(template: BoundModelFormula, workbook: Workbook, rowIndex: number): string {
  const edits: (FormulaSourceSpan & { value: string })[] = [];
  for (const reference of template.references) {
    const sheet = reference.sheetId ? workbook.documents[reference.sheetId] : undefined;
    const values = reference.endpoints.map((endpoint) => {
      if (!endpoint || !sheet || !sheet.content.columns.includes(endpoint.columnId)) return undefined;
      if (endpoint.propertyId && (sheet.modelColumnBindings?.[endpoint.propertyId] !== endpoint.columnId
        || !workbook.dataModels?.[sheet.modelId ?? '']?.columns.some((column) => column.id === endpoint.propertyId))) return undefined;
      const rowId = sheet.content.rows[endpoint.rowIndex + (endpoint.anchors.row ? 0 : rowIndex)];
      return rowId ? formatCanonicalFormulaEndpoint({ columnId: endpoint.columnId, rowId }, endpoint.anchors, endpoint.propertyId) : undefined;
    });
    if (!sheet || values.some((value) => value === undefined)) {
      edits.push({ ...reference.sourceSpan, value: '@#REF!A[1]' });
    } else {
      if (reference.qualifierSpan) edits.push({ ...reference.qualifierSpan, value: sheet.id });
      reference.endpoints.forEach((endpoint, index) => edits.push({ ...endpoint!.sourceSpan, value: values[index]! }));
    }
  }
  return edits.sort((a, b) => b.start - a.start).reduce((raw, edit) => raw.slice(0, edit.start) + edit.value + raw.slice(edit.end), template.raw);
}

/** Call only after every affected sheet has its final reconciled structure. */
export function instantiateModelFormulas(workbook: Workbook, sheetId: string, bindings = bindModelFormulas(workbook, sheetId)): SheetDocument {
  const sheet = workbook.documents[sheetId];
  const cells = { ...sheet.content.cells };
  for (const [propertyId, template] of Object.entries(bindings)) {
    const columnId = sheet.modelColumnBindings?.[propertyId];
    if (!columnId || !sheet.content.columns.includes(columnId)) continue;
    sheet.content.rows.forEach((rowId, rowIndex) => {
      cells[cellIdentityKey({ rowId, columnId })] = instantiateModelFormula(template, workbook, rowIndex);
    });
  }
  return { ...sheet, content: { ...sheet.content, cells } };
}

/**
 * Recomputes the derived instance of every bound calculated cell from its persisted template.
 *
 * A structural change that invalidates a derived instance must update the dependent sheets in the
 * same operation, so no client keeps a calculation its declarations no longer produce.
 */
export function refreshDerivedInstances(workbook: Workbook): Workbook {
  const documents = { ...workbook.documents };
  for (const sheet of Object.values(workbook.documents)) {
    const bindings = sheet.modelFormulaBindings;
    if (!bindings || Object.keys(bindings).length === 0) continue;
    documents[sheet.id] = instantiateModelFormulas(workbook, sheet.id, bindings);
  }
  return { ...workbook, documents };
}
