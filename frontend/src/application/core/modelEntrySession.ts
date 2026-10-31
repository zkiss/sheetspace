import type { DataModel, SheetDocument, Workbook } from '@workbook/core/model';
import { prepareCellInput } from './cellInputPreparation';
import { changeEntryField, createModelEntryDraft, dismissEntryFeedback, leaveEntryField, validateEntryDraft, type ModelEntryDraft } from './modelEntryDraft';

export type EntrySubmission = { rowId: string; revision?: number; values: Readonly<Record<string, string>> };
export class EntryAdmissionRejected extends Error {}
export type EntrySessionState = { draft: ModelEntryDraft; pending: boolean; failure?: string; retryRequired?: boolean; stale?: boolean };
type Session = EntrySessionState & { signature: string; submission?: EntrySubmission };

/** Session-only entry state; callers own persistence serialization and reconciliation. */
export class ModelEntrySessions {
  private readonly sessions = new Map<string, Session>();

  private signature(model: DataModel) {
    return JSON.stringify(model.columns.map(({ id, kind, type }) => [id, kind, type]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
  }

  get(sheetId: string, model: DataModel): EntrySessionState {
    const signature = this.signature(model);
    let session = this.sessions.get(sheetId);
    if (session && (session.draft.modelId !== model.id || session.signature !== signature)) {
      if (session.submission || Object.values(session.draft.fields).some((field) => field.raw !== '')) {
        session.stale = true;
        session.failure = 'The model changed while this draft was unfinished.';
        return session;
      }
      session = undefined;
    }
    if (!session) {
      session = { draft: createModelEntryDraft(model), signature, pending: false };
      this.sessions.set(sheetId, session);
    }
    delete session.stale;
    return session;
  }

  remove(sheetId: string) { this.sessions.delete(sheetId); }

  hasUnfinished(sheetId: string) {
    const session = this.sessions.get(sheetId);
    return Boolean(session && (session.submission || Object.values(session.draft.fields).some((field) => field.raw !== '')));
  }

  protectsTransition(before: Workbook, after: Workbook, sheetId: string) {
    if (!this.hasUnfinished(sheetId)) return false;
    const previous = before.documents[sheetId];
    const next = after.documents[sheetId];
    if (!previous || !next || previous.modelId !== next.modelId) return true;
    if (JSON.stringify(previous.modelColumnBindings) !== JSON.stringify(next.modelColumnBindings)) return true;
    const oldModel = previous.modelId && before.dataModels?.[previous.modelId];
    const newModel = next.modelId && after.dataModels?.[next.modelId];
    return !oldModel || !newModel || this.signature(oldModel) !== this.signature(newModel);
  }

  change(sheetId: string, model: DataModel, propertyId: string, raw: string, workbook: Workbook) {
    const session = this.get(sheetId, model) as Session;
    if (!session.pending && !session.submission && !session.stale) session.draft = changeEntryField(session.draft, model, propertyId, raw, workbook, sheetId);
    return session;
  }

  leave(sheetId: string, model: DataModel, propertyId: string, workbook: Workbook) {
    const session = this.get(sheetId, model) as Session;
    if (!session.stale) session.draft = leaveEntryField(session.draft, model, propertyId, workbook, sheetId);
    return session;
  }

  dismiss(sheetId: string, model: DataModel, propertyId: string) {
    const session = this.get(sheetId, model) as Session;
    session.draft = dismissEntryFeedback(session.draft, propertyId);
    return session;
  }

  async submit(sheetId: string, model: DataModel, workbook: Workbook, createId: () => string,
    admit: (submission: EntrySubmission) => Promise<{ rowId: string; sheet: SheetDocument }>,
  ): Promise<{ firstInvalid?: string; result?: { rowId: string; sheet: SheetDocument } }> {
    const session = this.get(sheetId, model) as Session;
    if (session.pending || session.stale) return {};
    if (!session.submission) {
      const validation = validateEntryDraft(session.draft, model, workbook, sheetId);
      session.draft = validation.draft;
      if (validation.firstInvalid) return { firstInvalid: validation.firstInvalid };
      session.submission = {
        rowId: createId(),
        values: Object.fromEntries(model.columns.filter((column) => column.kind === 'manual').map((column) => [column.id, prepareCellInput(session.draft.fields[column.id]!.raw, workbook, sheetId)])),
      };
    }
    session.pending = true;
    session.retryRequired = true;
    delete session.failure;
    try {
      const result = await admit(session.submission);
      if (this.sessions.get(sheetId) === session) this.sessions.set(sheetId, { draft: createModelEntryDraft(model), signature: session.signature, pending: false });
      return { result };
    } catch (error) {
      if (error instanceof EntryAdmissionRejected) {
        delete session.submission;
        delete session.retryRequired;
      }
      session.failure = error instanceof Error ? error.message : 'Could not save record. Retry the submission.';
      return {};
    } finally {
      session.pending = false;
    }
  }
}
