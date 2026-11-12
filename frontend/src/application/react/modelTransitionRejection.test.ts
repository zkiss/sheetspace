import { describe, expect, it } from 'vitest';
import { ModelEntrySessions } from '@application/core/modelEntrySession';
import { deleteRow } from '@application/core/deleteRow';
import { deletionFixture } from '@test-support/recordDeletionFixture';
import { modelTransitionRejection } from './modelTransitionRejection';

describe('deletion entry-session protection', () => {
  it.each(['sheet', 'other'])('protects only an unfinished draft whose sheet changes: %s', (draftSheetId) => {
    const { initial, rowId } = deletionFixture(true);
    const other = initial.documents.other!;
    const before = { ...initial, documents: { ...initial.documents,
      other: { ...other, modelId: 'model', modelColumnBindings: { input: other.content.columns[0]! } },
    } };
    const sessions = new ModelEntrySessions();
    sessions.change(draftSheetId, before.dataModels!.model!, 'input', '42', before);
    const deleted = deleteRow(before, 'sheet', rowId);
    if (!deleted.ok) throw new Error(deleted.reason);
    const rejection = modelTransitionRejection({ before, after: deleted.value, protectEntryContents: true,
      admissionLocks: new Set(), entrySessions: sessions, axisPending: false, sheetPending: false, lifecyclePending: false, failedPrerequisite: false,
    });
    expect(rejection).toEqual(draftSheetId === 'sheet' ? { ok: false, reason: 'pending-model-transition' } : undefined);
  });
});
