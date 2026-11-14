import { validRecordValues } from '../../../../frontend/src/calculation/recordValidation';
import type { DataModel, SheetDocument, Workbook, WorkbookManifest } from '../../../../frontend/src/workbook/core/model';
import { cellIdentityKey } from '../../../../frontend/src/workbook/core/cellIdentity';
import { bindCustomFunctionsForSheet, reconcileFunctionBodyBinding, setCustomFunction } from '../../../../frontend/src/calculation/customFunctions';
import type { CustomFunction } from '../../../../frontend/src/workbook/core/model';
import type { StoredFormulaContent } from '../../../../frontend/src/workbook/core/storedFormulaContent';

type Bundle = {
  manifest: WorkbookManifest;
  documents: (Omit<SheetDocument, 'content'> & { content: Omit<SheetDocument['content'], 'cells'> & {
    cells: { rowId: string; columnId: string; content: string }[];
  } })[];
  dataModels: DataModel[];
  functions: CustomFunction[];
};

function workbookFromBundle(bundleJson: string): Workbook {
  const bundle: Bundle = JSON.parse(bundleJson);
  const workbook: Workbook = {
    manifest: bundle.manifest,
    documents: Object.fromEntries(bundle.documents.map((sheet) => [sheet.id, {
      ...sheet,
      content: { ...sheet.content, cells: Object.fromEntries(sheet.content.cells.map((cell) => [cellIdentityKey(cell), cell.content])) },
    }])),
    dataModels: Object.fromEntries(bundle.dataModels.map((model) => [model.id, model])),
    functions: bundle.functions,
  };
  return workbook;
}

export function validate(bundleJson: string, sheetId: string, valuesJson: string): boolean {
  return validRecordValues(workbookFromBundle(bundleJson), sheetId, JSON.parse(valuesJson));
}

export function admitFunction(bundleJson: string, declarationJson: string, previousName: string | null): string {
  const declaration: CustomFunction = JSON.parse(declarationJson);
  const result = setCustomFunction(workbookFromBundle(bundleJson), { name: declaration.name, parameters: declaration.parameters, body: declaration.body }, previousName ?? undefined);
  return JSON.stringify(result.ok ? { functions: result.workbook.functions } : { error: result.error });
}

export function bindFunctionSheet(bundleJson: string, sheetId: string): string {
  return JSON.stringify(bindCustomFunctionsForSheet(workbookFromBundle(bundleJson), sheetId).functions ?? []);
}

export function reconcileFunctionBinding(bundleJson: string, sheetId: string, previousJson: string, binding: string | null, nextJson: string, excludedQualifiedSheetId: string | null): string {
  return JSON.stringify(reconcileFunctionBodyBinding(workbookFromBundle(bundleJson), sheetId, JSON.parse(previousJson), binding as StoredFormulaContent | undefined, JSON.parse(nextJson), excludedQualifiedSheetId ?? undefined) ?? null);
}
