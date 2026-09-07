import { SheetId } from '@workbook/core/model';
import type { WorkbookOperationId } from '@application/core/userActions';

export type MissingSheetSource = {
  savedOperationId?: WorkbookOperationId;
  axisOperationId?: string;
};

type MissingSheetListener = (sheetId: SheetId, source: MissingSheetSource) => void;

/** Shared backend-authoritative sheet lifecycle and revision state for all persistence queues. */
export class WorkbookPersistenceCoordinator {
  private readonly revisions = new Map<SheetId, number>();
  private readonly missingSheetIds = new Set<SheetId>();
  private readonly missingSheetListeners = new Set<MissingSheetListener>();

  revision(sheetId: SheetId) {
    return this.revisions.get(sheetId);
  }

  recordRevision(sheetId: SheetId, revision: number) {
    const recorded = Math.max(this.revisions.get(sheetId) ?? revision, revision);
    this.revisions.set(sheetId, recorded);
    return recorded;
  }

  recordRevisions(revisions: readonly { sheetId: SheetId; revision: number }[]) {
    return revisions.map(({ sheetId, revision }) => ({
      sheetId,
      revision: this.recordRevision(sheetId, revision),
    }));
  }

  isSheetMissing(sheetId: SheetId) {
    return this.missingSheetIds.has(sheetId);
  }

  subscribeToMissingSheets(listener: MissingSheetListener) {
    this.missingSheetListeners.add(listener);
    return () => {
      this.missingSheetListeners.delete(listener);
    };
  }

  confirmSheetMissing(sheetId: SheetId, source: MissingSheetSource = {}) {
    this.missingSheetIds.add(sheetId);
    for (const listener of this.missingSheetListeners) listener(sheetId, source);
  }
}
