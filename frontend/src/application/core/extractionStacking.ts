import type { SheetDocument, Workbook } from '@workbook/core/model';
import { sheetsInOrder } from '@workbook/read/queries';

const MAX_Z = 2147483647;

export function insertExtractionStacking(workbook: Workbook, sourceId: string, target: SheetDocument): Workbook {
  const ordered = [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex);
  const sourceIndex = ordered.findIndex((sheet) => sheet.id === sourceId);
  ordered.splice(sourceIndex + 1, 0, target);
  const original = ordered.map((sheet) => sheet.frame.zIndex);
  const targetIndex = sourceIndex + 1;
  const upward = [...original];
  upward[targetIndex] = upward[sourceIndex]! + 1;
  for (let i = targetIndex + 1; i < ordered.length && upward[i]! <= upward[i - 1]!; i++) upward[i] = upward[i - 1]! + 1;
  const downward = [...original];
  downward[targetIndex] = targetIndex + 1 < ordered.length ? downward[targetIndex + 1]! - 1 : MAX_Z;
  for (let i = sourceIndex; i >= 0 && downward[i]! >= downward[i + 1]!; i--) downward[i] = downward[i + 1]! - 1;
  const changes = (values: number[]) => values.reduce((count, value, index) => count + Number(index !== targetIndex && value !== original[index]), 0);
  const values = upward[upward.length - 1]! <= MAX_Z && (downward[0]! < 1 || changes(upward) <= changes(downward)) ? upward : downward;
  const documents = { ...workbook.documents };
  ordered.forEach((sheet, index) => {
    documents[sheet.id] = sheet.frame.zIndex === values[index] ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex: values[index]! } };
  });
  return { ...workbook, manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, target.id] }, documents };
}
