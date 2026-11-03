import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { deleteColumn } from './deleteColumn';
import { deleteRow } from './deleteRow';
import { prepareExtraction, type ExtractionRequest, type ExtractionPreparationFailure } from './extractionPreparation';
import { prepareExtractionReferences, type ExtractionReferenceResult } from './extractionReferences';
import { insertExtractionStacking } from './extractionStacking';
import type { CellWrite } from './userActions';

export type ExtractionFailure = ExtractionPreparationFailure | Extract<ExtractionReferenceResult, { ok: false }>['reason'];
export type ExtractionResult = { ok: false; reason: ExtractionFailure } | { ok: true; workbook: Workbook; targetSheetId: string; origin: { row: number; column: number }; extents: { rowCount: number; columnCount: number } };

function applyWrites(workbook: Workbook, writes: readonly CellWrite[]): Workbook {
  const documents = { ...workbook.documents };
  const changed = new Set<string>();
  for (const write of writes) {
    if (!changed.has(write.sheetId)) {
      const sheet = documents[write.sheetId]!;
      documents[write.sheetId] = { ...sheet, content: { ...sheet.content, cells: { ...sheet.content.cells } } };
      changed.add(write.sheetId);
    }
    const cells = documents[write.sheetId]!.content.cells;
    const key = cellIdentityKey(write);
    if (write.raw === '') delete cells[key]; else cells[key] = write.raw;
  }
  return { ...workbook, documents };
}

export function extractSelection(workbook: Workbook, request: ExtractionRequest): ExtractionResult {
  const preparation = prepareExtraction(workbook, request);
  if (!preparation.ok) return preparation;
  const prepared = preparation.value;
  const references = prepareExtractionReferences(prepared);
  if (!references.ok) return references;
  let result = applyWrites(prepared.workbook, references.writes);
  if (request.selection.kind === 'cells') {
    const source = result.documents[prepared.sourceSheetId]!;
    const formats = source.presentation.formatOverrides;
    if (formats) {
      const cells = { ...formats.cells };
      for (const mapping of prepared.mappings) delete cells[cellIdentityKey(mapping.source.cell)];
      result = { ...result, documents: { ...result.documents, [source.id]: { ...source, presentation: { ...source.presentation, formatOverrides: { ...formats, cells } } } } };
    }
  } else if (request.selection.kind === 'rows') {
    for (const id of prepared.sourceRows) {
      const deletion = deleteRow(result, prepared.sourceSheetId, id);
      if (!deletion.ok) throw new Error('Validated extraction axis could not be removed');
      result = deletion.value;
    }
  } else {
    for (const id of prepared.sourceColumns) {
      const deletion = deleteColumn(result, prepared.sourceSheetId, id);
      if (!deletion.ok) throw new Error('Validated extraction axis could not be removed');
      result = deletion.value;
    }
  }
  const target = result.documents[prepared.targetSheetId]!;
  const withoutTarget = { ...result, manifest: { ...result.manifest, sheetIds: result.manifest.sheetIds.filter((id) => id !== target.id) } };
  result = insertExtractionStacking(withoutTarget, prepared.sourceSheetId, target);
  return { ok: true, workbook: result, targetSheetId: prepared.targetSheetId, origin: prepared.origin, extents: prepared.extents };
}
