import type { Workbook } from '@workbook/core/model';
import { deleteFunction, setFunction, type FunctionDeclaration } from './functionCommands';

export type FunctionReceipt = { operationId: string; committedIdentity: string; alreadyCommitted: boolean; workbook: Workbook };
type Intent = { kind: 'set'; declaration: FunctionDeclaration; previousName?: string } | { kind: 'delete'; name: string };
type Coordinator = {
  serializeWorkbook<T>(request: () => Promise<T>): Promise<T>;
  revision(sheetId: string): number | undefined;
  recordSnapshot(revisions: readonly { sheetId: string; revision: number }[], removed: readonly string[]): unknown;
  confirmSheetMissing(sheetId: string): void;
};
type Options = {
  coordinator: Coordinator;
  currentWorkbook: () => Workbook;
  loadWorkbook: () => Promise<Workbook>;
  setFunction: (id: string, before: Workbook, declaration: FunctionDeclaration, previousName?: string) => Promise<FunctionReceipt>;
  deleteFunction: (id: string, before: Workbook, name: string) => Promise<FunctionReceipt>;
  reconcile: (workbook: Workbook) => void;
  definitelyRejected: (error: unknown) => boolean;
};
type Retained = { id: string; intent: Intent; before?: Workbook; rejection?: { error: unknown } };
type Phase = 'idle' | 'accepted' | 'preparing' | 'dispatched' | 'failed-unprepared' | 'failed-dispatched' | 'rejected-awaiting-reconciliation' | 'acknowledged' | 'rejected';

export class FunctionCommandOwner {
  private active?: Retained;
  private running = false;
  phase: Phase = 'idle';
  get pending() { return this.running; }
  get unresolved() { return this.active !== undefined; }

  reserve(intent: Intent, id = crypto.randomUUID()) {
    if (this.active || this.running) throw new Error('Resolve the pending function operation first.');
    this.active = { id, intent: structuredClone(intent) };
    this.phase = 'accepted';
  }

  fail() { this.phase = this.active?.rejection ? 'rejected-awaiting-reconciliation' : this.active?.before ? 'failed-dispatched' : this.active ? 'failed-unprepared' : 'rejected'; }

  start(intent: Intent, options: Options, id = crypto.randomUUID()) {
    this.reserve(intent, id);
    return this.retry(options);
  }

  retry(options: Options) {
    if (this.running || !this.active) throw new Error('No unresolved function operation.');
    return this.execute(this.active, options);
  }

  private async execute(state: Retained, options: Options): Promise<Workbook> {
    this.running = true;
    this.phase = state.rejection ? 'rejected-awaiting-reconciliation' : state.before ? 'dispatched' : 'preparing';
    try {
      return await options.coordinator.serializeWorkbook(async () => {
        const adopt = (workbook: Workbook) => {
          const current = options.currentWorkbook();
          if (!workbook?.manifest || !workbook.documents || workbook.manifest.revision < current.manifest.revision || Object.values(workbook.documents).some((sheet) =>
            sheet.revision < Math.max(options.coordinator.revision(sheet.id) ?? 0, current.documents[sheet.id]?.revision ?? 0))) {
            throw new Error('The workbook response is older than a confirmed save.');
          }
          const removed = current.manifest.sheetIds.filter((id) => !workbook.documents[id]);
          options.coordinator.recordSnapshot(Object.values(workbook.documents).map(({ id, revision }) => ({ sheetId: id, revision })), removed);
          removed.forEach((id) => options.coordinator.confirmSheetMissing(id));
          options.reconcile(workbook);
        };
        const reconcileRejection = async () => {
          await options.loadWorkbook().then(adopt);
          this.active = undefined;
          this.phase = 'rejected';
          throw state.rejection!.error;
        };
        if (state.rejection) return reconcileRejection();
        if (!state.before) {
          const before = await options.loadWorkbook();
          adopt(before);
          const result = state.intent.kind === 'set' ? setFunction(before, state.intent.declaration, state.intent.previousName) : deleteFunction(before, state.intent.name);
          if (!result.ok) {
            this.active = undefined;
            this.phase = 'rejected';
            throw new Error(`Function declaration rejected: ${result.reason}`);
          }
          state.before = structuredClone(before);
        }
        this.phase = 'dispatched';
        const before = structuredClone(state.before);
        const intent = structuredClone(state.intent);
        let receipt: FunctionReceipt;
        try {
          receipt = intent.kind === 'set'
            ? await options.setFunction(state.id, before, intent.declaration, intent.previousName)
            : await options.deleteFunction(state.id, before, intent.name);
        } catch (error) {
          if (options.definitelyRejected(error)) {
            state.rejection = { error };
            this.phase = 'rejected-awaiting-reconciliation';
            return reconcileRejection();
          }
          throw error;
        }
        if (!receipt || typeof receipt.operationId !== 'string' || receipt.operationId.toLowerCase() !== state.id.toLowerCase() ||
          typeof receipt.committedIdentity !== 'string' || !receipt.committedIdentity.trim() || typeof receipt.alreadyCommitted !== 'boolean') {
          throw new Error('Invalid function receipt.');
        }
        adopt(receipt.workbook);
        this.active = undefined;
        this.phase = 'acknowledged';
        return receipt.workbook;
      });
    } catch (error) { this.fail(); throw error; } finally { this.running = false; }
  }
}
