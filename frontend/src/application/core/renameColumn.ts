import { namedColumns } from '@workbook/core/columnNames';
import { renameOrdinaryColumn } from '@workbook/mutations/renameOrdinaryColumn';
import type { Workbook } from '@workbook/core/model';
import { replaceModelDeclaration } from './modelLifecycle';

export type RenameColumnTarget =
  | { kind: 'ordinary'; sheetId: string; columnId: string }
  | { kind: 'property'; sheetId: string; columnId: string; modelId: string; modelName: string; propertyId: string; propertyName: string };

export function columnRenameTarget(workbook: Workbook, sheetId: string, columnId: string): RenameColumnTarget | undefined {
  const sheet = workbook.documents[sheetId];
  if (!sheet?.content.columns.includes(columnId)) return undefined;
  const model = sheet.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  const property = model?.columns.find((candidate) => sheet.modelColumnBindings?.[candidate.id] === columnId);
  return model && property
    ? { kind: 'property', sheetId, columnId, modelId: model.id, modelName: model.name, propertyId: property.id, propertyName: property.name }
    : { kind: 'ordinary', sheetId, columnId };
}

export function renameColumn(workbook: Workbook, sheetId: string, columnId: string, input: string):
  | { ok: true; value: Workbook }
  | { ok: false; reason: 'unknown-column' | 'empty' | 'duplicate'; sheetId?: string } {
  const target = columnRenameTarget(workbook, sheetId, columnId);
  if (!target) return { ok: false, reason: 'unknown-column' };
  const name = input.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (target.kind === 'ordinary') {
    const result = renameOrdinaryColumn(workbook, sheetId, columnId, name);
    return result.ok ? result : { ok: false, reason: result.reason === 'duplicate' ? 'duplicate' : 'unknown-column' };
  }
  const model = workbook.dataModels![target.modelId]!;
  if (model.columns.some((property) => property.id !== target.propertyId && property.name.trim() === name)) return { ok: false, reason: 'duplicate' };
  for (const sheet of Object.values(workbook.documents)) {
    const bound = sheet.modelId === model.id && sheet.modelColumnBindings?.[target.propertyId];
    if (bound && sheet.content.columns.includes(bound) && namedColumns(workbook, sheet).some((column) => column.columnId !== bound && column.name === name)) {
      return { ok: false, reason: 'duplicate', sheetId: sheet.id };
    }
  }
  const result = replaceModelDeclaration(workbook, { ...model, columns: model.columns.map((property) => property.id === target.propertyId ? { ...property, name } : property) }, () => { throw new Error('A rename cannot allocate columns'); });
  return result.ok ? result : { ok: false, reason: 'unknown-column' };
}
