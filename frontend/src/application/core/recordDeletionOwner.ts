import type { FormulaCalculation } from '@calculation/formulaCalculation';
import type { Workbook } from '@workbook/core/model';
import { deleteRow } from './deleteRow';
import type { RecordDeletionRequest, RecordDeletionResult } from './recordReplay';
import { settleSorting } from './settleSorting';

type Coordinator = {
  serializeWorkbook<T>(request: () => Promise<T>): Promise<T>;
  revision(sheetId: string): number | undefined;
  recordSnapshot(revisions: readonly { sheetId: string; revision: number }[], removed: readonly string[]): unknown;
  confirmSheetMissing(sheetId: string): void;
};
type Identity = { sheetId: string; rowId: string; operationId: string };
type Options = {
  coordinator: Coordinator;
  waitForPredecessors: () => Promise<void>;
  currentWorkbook: () => Workbook;
  loadWorkbook: () => Promise<Workbook>;
  calculator: FormulaCalculation;
  deleteRecord: (sheetId: string, rowId: string, request: RecordDeletionRequest) => Promise<RecordDeletionResult>;
  reconcile: (workbook: Workbook) => void;
  recover?: (error: unknown, refresh: () => Promise<void>) => Promise<never>;
};
type Retained = { identity: Identity; request?: RecordDeletionRequest; dispatched: boolean };

/** The caller holds the checked workbook mutation barrier through drain, dispatch and adoption. */
export class RecordDeletionOwner {
  private active?: Retained;
  private running = false;

  get pending() { return this.running; }
  get unresolved() { return this.active?.dispatched === true; }
  get identity(): Identity | undefined { return this.active && { ...this.active.identity }; }

  async start(sheetId: string, rowId: string, options: Options) {
    if (this.running || this.active) throw new Error('Resolve the pending record deletion before continuing.');
    this.active = { identity: { sheetId, rowId, operationId: crypto.randomUUID() }, dispatched: false };
    return this.execute(this.active, options);
  }

  async confirmRetained(options: Options) {
    if (this.running || !this.active?.dispatched) throw new Error('There is no unresolved record deletion to confirm.');
    return this.execute(this.active, options);
  }

  private async execute(state: Retained, options: Options) {
    this.running = true;
    try {
      await options.waitForPredecessors();
      return await options.coordinator.serializeWorkbook(async () => {
        const adopt = (workbook: Workbook) => {
          const current = options.currentWorkbook();
          if (workbook.manifest.revision < current.manifest.revision || Object.values(workbook.documents).some((sheet) =>
            sheet.revision < Math.max(options.coordinator.revision(sheet.id) ?? 0, current.documents[sheet.id]?.revision ?? 0))) {
            throw new Error('The workbook response is older than a confirmed save. Retry to refresh it.');
          }
          const removed = current.manifest.sheetIds.filter((id) => !workbook.documents[id]);
          options.coordinator.recordSnapshot(Object.values(workbook.documents).map(({ id, revision }) => ({ sheetId: id, revision })), removed);
          removed.forEach((id) => options.coordinator.confirmSheetMissing(id));
          options.reconcile(workbook);
        };
        if (!state.request) {
          const before = await options.loadWorkbook();
          adopt(before);
          const candidate = deleteRow(before, state.identity.sheetId, state.identity.rowId);
          if (!candidate.ok) throw new Error('The record is no longer available.');
          const orders = settleSorting(candidate.value, options.calculator, { kind: 'structure' }).orders;
          state.request = structuredClone({ operationId: state.identity.operationId, before, rowOrders: orders.map(({ sheetId, after }) => ({ sheetId, order: after })) });
        }
        state.dispatched = true;
        const result = await options.deleteRecord(state.identity.sheetId, state.identity.rowId, structuredClone(state.request)).catch((error: unknown) => {
          if (options.recover) return options.recover(error, async () => {
            adopt(await options.loadWorkbook());
            this.active = undefined;
          });
          throw error;
        });
        if (typeof result?.operationId !== 'string' || result.operationId.toLowerCase() !== state.identity.operationId.toLowerCase() ||
          typeof result.rowId !== 'string' || result.rowId.toLowerCase() !== state.identity.rowId.toLowerCase() ||
          typeof result.deletionId !== 'string' || !result.deletionId || typeof result.alreadyCommitted !== 'boolean') {
          throw new Error('The deletion response did not match the operation. Retry to confirm it.');
        }
        adopt(result.workbook);
        this.active = undefined;
        return result;
      });
    } catch (error) {
      if (!state.dispatched) this.active = undefined;
      throw error;
    } finally {
      this.running = false;
    }
  }
}
