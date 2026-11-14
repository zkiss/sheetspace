import type { Workbook } from '@workbook/core/model';
import { validLifecycleBundle } from '@application/core/lifecycleFunctionValidation';

export type SheetCreationReceipt = { sheetId: string; workbook: Workbook };
export type SheetCreationWireReceipt<Bundle> = { sheetId: string; workbook: Bundle };

export function decodeSheetCreationReceipt<Bundle extends { manifest: { revision: number }; documents: { revision: number }[]; dataModels: unknown[]; functions?: Workbook['functions'] }>(result: SheetCreationWireReceipt<Bundle>, decodeWorkbookBundle: (bundle: Bundle) => Workbook): SheetCreationReceipt {
  if (!result || typeof result.sheetId !== 'string' || !result.sheetId || !result.workbook
    || !validLifecycleBundle(result.workbook)) throw new Error('Invalid sheet creation receipt.');
  const workbook = decodeWorkbookBundle(result.workbook);
  if (!Object.prototype.hasOwnProperty.call(workbook.documents, result.sheetId)) throw new Error('Invalid sheet creation receipt.');
  return { sheetId: result.sheetId, workbook };
}
