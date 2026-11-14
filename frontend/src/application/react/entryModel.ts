import type { DataModel, Workbook } from '@workbook/core/model';

export function entryModel(workbook: Workbook, sheetId: string): DataModel | undefined {
  const modelId = workbook.documents[sheetId]?.modelId;
  return modelId ? workbook.dataModels?.[modelId] : undefined;
}
