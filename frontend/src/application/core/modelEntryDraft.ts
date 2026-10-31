import { classifyCellValue, matchesModelColumnType } from '@calculation/formulaValue';
import { prepareCellInput } from './cellInputPreparation';
import type { DataModel, Workbook } from '@workbook/core/model';

export type EntryField = { raw: string; invalid: boolean; message?: string };
export type ModelEntryDraft = { modelId: string; fields: Readonly<Record<string, EntryField>> };

export function createModelEntryDraft(model: DataModel): ModelEntryDraft {
  return { modelId: model.id, fields: Object.fromEntries(model.columns.filter((column) => column.kind === 'manual').map((column) => [column.id, { raw: '', invalid: false }])) };
}

function fieldError(model: DataModel, propertyId: string, raw: string, workbook: Workbook, sheetId: string): string | undefined {
  const property = model.columns.find((column) => column.id === propertyId && column.kind === 'manual');
  if (!property) return undefined;
  const stored = prepareCellInput(raw, workbook, sheetId);
  if (stored.startsWith('=') || matchesModelColumnType(classifyCellValue(stored), property.type)) return undefined;
  return `Enter a valid ${property.type} value.`;
}

export function changeEntryField(draft: ModelEntryDraft, model: DataModel, propertyId: string, raw: string, workbook: Workbook, sheetId: string): ModelEntryDraft {
  const field = draft.fields[propertyId];
  if (!field || draft.modelId !== model.id) return draft;
  const error = field.invalid ? fieldError(model, propertyId, raw, workbook, sheetId) : undefined;
  return { ...draft, fields: { ...draft.fields, [propertyId]: { raw, invalid: Boolean(error), ...(error && field.message ? { message: error } : {}) } } };
}

export function leaveEntryField(draft: ModelEntryDraft, model: DataModel, propertyId: string, workbook: Workbook, sheetId: string): ModelEntryDraft {
  const field = draft.fields[propertyId];
  if (!field || draft.modelId !== model.id) return draft;
  const message = fieldError(model, propertyId, field.raw, workbook, sheetId);
  return { ...draft, fields: { ...draft.fields, [propertyId]: { raw: field.raw, invalid: Boolean(message), ...(message ? { message } : {}) } } };
}

export function dismissEntryFeedback(draft: ModelEntryDraft, propertyId: string): ModelEntryDraft {
  const field = draft.fields[propertyId];
  if (!field?.message) return draft;
  return { ...draft, fields: { ...draft.fields, [propertyId]: { raw: field.raw, invalid: field.invalid } } };
}

export function validateEntryDraft(draft: ModelEntryDraft, model: DataModel, workbook: Workbook, sheetId: string): { draft: ModelEntryDraft; firstInvalid?: string } {
  let next = draft;
  let firstInvalid: string | undefined;
  for (const column of model.columns) {
    if (column.kind !== 'manual') continue;
    next = leaveEntryField(next, model, column.id, workbook, sheetId);
    if (next.fields[column.id]?.invalid && !firstInvalid) firstInvalid = column.id;
  }
  return { draft: next, ...(firstInvalid ? { firstInvalid } : {}) };
}
