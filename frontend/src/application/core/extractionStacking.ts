import type { SheetDocument, Workbook } from '@workbook/core/model';
import { sheetsInOrder } from '@workbook/read/queries';

const MAX_Z = 2147483647;

export function insertExtractionStacking(workbook: Workbook, sourceId: string, target: SheetDocument): Workbook {
  const ordered = [...sheetsInOrder(workbook)].sort((a, b) => a.frame.zIndex - b.frame.zIndex);
  const sourceIndex = ordered.findIndex((sheet) => sheet.id === sourceId);
  ordered.splice(sourceIndex + 1, 0, target);
  const values = ordered.map((sheet) => sheet.frame.zIndex);
  values[sourceIndex + 1] = values[sourceIndex]! + 1;
  for (let i = sourceIndex + 2; i < ordered.length && values[i]! <= values[i - 1]!; i++) values[i] = values[i - 1]! + 1;
  if (values.some((value) => value > MAX_Z)) {
    values[values.length - 1] = MAX_Z;
    for (let i = values.length - 2; i >= 0 && values[i]! >= values[i + 1]!; i--) values[i] = values[i + 1]! - 1;
  }
  const documents = { ...workbook.documents };
  ordered.forEach((sheet, index) => {
    documents[sheet.id] = sheet.frame.zIndex === values[index] ? sheet : { ...sheet, frame: { ...sheet.frame, zIndex: values[index]! } };
  });
  return { ...workbook, manifest: { ...workbook.manifest, sheetIds: [...workbook.manifest.sheetIds, target.id] }, documents };
}
