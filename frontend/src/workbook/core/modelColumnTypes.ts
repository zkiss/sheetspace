import type { ModelColumnType, SheetDocument, Workbook } from './model';

export function boundColumnType(sheet: SheetDocument, models: Workbook['dataModels'], columnId: string): ModelColumnType | undefined {
  const model = sheet.modelId ? models?.[sheet.modelId] : undefined;
  return model?.columns.find((column) => sheet.modelColumnBindings?.[column.id] === columnId)?.type;
}
