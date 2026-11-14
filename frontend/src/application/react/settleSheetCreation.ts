import type { Workbook } from '@workbook/core/model';
import type { CreatingSheetFrame } from '@application/core/sheetCreationState';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { reconcileSheetCreation } from '@application/core/creationReconciliation';
import type { SheetCreationReceipt } from '@infrastructure/persistence/sheetCreationReceipt';
import type { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';

export function settleSheetCreation({ baseline, request, receipt, current, coordinator, setWorkbook }: {
  baseline: Workbook;
  request: CreatingSheetFrame;
  receipt: SheetCreationReceipt;
  current: () => Workbook;
  coordinator: WorkbookPersistenceCoordinator;
  setWorkbook: SetWorkbook;
}) {
  return coordinator.serializeWorkbook(async () => {
    const created = receipt.workbook.documents[receipt.sheetId];
    if (!created || created.name !== request.name
      || created.frame.position.x !== request.position.x || created.frame.position.y !== request.position.y
      || created.frame.size.width !== request.size.width || created.frame.size.height !== request.size.height
      || created.frame.visualScale !== request.visualScale || created.frame.zIndex !== request.zIndex) return undefined;
    if (coordinator.isSheetMissing(receipt.sheetId)) return undefined;
    const workbook = current();
    const revisions = Object.fromEntries([...new Set([...Object.keys(workbook.documents), ...Object.keys(receipt.workbook.documents)])]
      .flatMap((id) => { const revision = coordinator.revision(id); return revision === undefined ? [] : [[id, revision]]; }));
    const result = reconcileSheetCreation({ baseline, current: workbook, receipt, revisions });
    if (!result.ok) return undefined;
    coordinator.recordRevisions(result.revisions);
    setWorkbook(result.workbook, { kind: 'structure' });
    return result.created;
  });
}
