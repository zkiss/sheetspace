import { cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculatedOwnedColumns } from '@workbook/core/calculatedOwnership';
import { bindModelFormulas, instantiateModelFormula } from '@workbook/formula/modelTemplate';
import { moveStoredFormula } from '@workbook/formula/storedFormulaMove';
import type { PreparedExtraction } from './extractionPreparation';
import type { CellWrite } from './userActions';

export type ExtractionReferenceResult = { ok: true; writes: readonly CellWrite[] } | { ok: false; reason: 'unrepresentable-range' | 'protected-model-formula' };

/** Plans against the intermediate workbook, before any original axes are removed. */
export function prepareExtractionReferences(prepared: PreparedExtraction): ExtractionReferenceResult {
  const { workbook, mappings, snapshot } = prepared;
  const moved = new Map(mappings.map((mapping) => [JSON.stringify([mapping.source.sheetId, cellIdentityKey(mapping.source.cell)]), mapping.destination]));
  const writes: CellWrite[] = [];
  const destinationWrites = new Map<string, CellWrite>();
  for (const row of snapshot.cells) for (const cell of row) {
    const destination = moved.get(JSON.stringify([snapshot.sheetId, cellIdentityKey(cell.identity)]))!;
    const write = { sheetId: destination.sheetId, ...destination.cell, raw: cell.raw };
    destinationWrites.set(JSON.stringify([destination.sheetId, cellIdentityKey(destination.cell)]), write);
    writes.push(write);
    writes.push({ sheetId: snapshot.sheetId, ...cell.identity, raw: '' });
  }
  for (const sheet of Object.values(workbook.documents)) {
    const owned = calculatedOwnedColumns(sheet, workbook.dataModels);
    for (const [key, raw] of Object.entries(sheet.content.cells)) {
      if (!raw.startsWith('=')) continue;
      const cell = cellIdentityFromKey(key);
      if (!cell) continue;
      const destination = moved.get(JSON.stringify([sheet.id, key]));
      const result = moveStoredFormula(raw, workbook, sheet.id, destination?.sheetId ?? sheet.id, mappings);
      if (!result.ok) return result;
      if (result.content === raw) continue;
      if (owned.has(cell.columnId)) return { ok: false, reason: 'protected-model-formula' };
      if (destination) {
        const write = destinationWrites.get(JSON.stringify([destination.sheetId, cellIdentityKey(destination.cell)]))!;
        write.raw = result.content;
      } else writes.push({ sheetId: sheet.id, ...cell, raw: result.content });
    }
    const bindings = sheet.modelFormulaBindings ?? (sheet.modelId ? bindModelFormulas(workbook, sheet.id) : {});
    for (const [propertyId, template] of Object.entries(bindings)) {
      const property = sheet.modelId && workbook.dataModels?.[sheet.modelId]?.columns.find((entry) => entry.id === propertyId && entry.kind === 'calculated');
      const formulas: string[] = [template.content];
      if (property && property.kind === 'calculated') {
        for (let row = 0; row < sheet.content.rows.length; row += 1) formulas.push(instantiateModelFormula(template, workbook, row, property.formula, sheet.id));
      }
      for (const formula of formulas) {
        const result = moveStoredFormula(formula, workbook, sheet.id, sheet.id, mappings);
        if (!result.ok || result.content !== formula) return { ok: false, reason: 'protected-model-formula' };
      }
    }
  }
  return { ok: true, writes };
}
