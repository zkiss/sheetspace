import { validRecordValues } from '../../../../frontend/src/calculation/recordValidation';
import type { DataModel, SheetDocument, Workbook, WorkbookManifest } from '../../../../frontend/src/workbook/core/model';
import { cellIdentityKey } from '../../../../frontend/src/workbook/core/cellIdentity';

type Bundle = {
  manifest: WorkbookManifest;
  documents: (Omit<SheetDocument, 'content'> & { content: Omit<SheetDocument['content'], 'cells'> & {
    cells: { rowId: string; columnId: string; content: string }[];
  } })[];
  dataModels: DataModel[];
};

export function validate(bundleJson: string, sheetId: string, valuesJson: string): boolean {
  const bundle: Bundle = JSON.parse(bundleJson);
  const workbook: Workbook = {
    manifest: bundle.manifest,
    documents: Object.fromEntries(bundle.documents.map((sheet) => [sheet.id, {
      ...sheet,
      content: { ...sheet.content, cells: Object.fromEntries(sheet.content.cells.map((cell) => [cellIdentityKey(cell), cell.content])) },
    }])),
    dataModels: Object.fromEntries(bundle.dataModels.map((model) => [model.id, model])),
  };
  return validRecordValues(workbook, sheetId, JSON.parse(valuesJson));
}
