import { describe, expect, it, vi } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { deletionFixture } from '@test-support/recordDeletionFixture';
import { submitRecordDeletion } from './submitRecordDeletion';

function submissionOptions(sorting = false) {
  const { initial, rowId } = deletionFixture(sorting);
  return {
    sheetId: 'sheet', rowId, before: initial, enabled: true, calculator: new FormulaCalculation(),
    local: vi.fn(), blocked: () => false, hasUnfinishedEntries: () => false,
    validate: vi.fn().mockReturnValue(undefined),
    capture: {
      state: { pending: false, unresolved: false }, blocked: () => false, canConfirm: () => false,
      start: vi.fn().mockResolvedValue({ ok: true, value: initial }), confirm: vi.fn(), confirmRetained: vi.fn(),
    },
  };
}

describe('record deletion admission', () => {
  it('refuses a noncommitted row before starting a capture', () => {
    const options = submissionOptions();
    const submission = submitRecordDeletion({ ...options, rowId: 'entry-draft' });
    expect(submission.result).toEqual({ ok: false, reason: 'unknown-row' });
    expect(options.capture.start).not.toHaveBeenCalled();
  });

  it('refuses a missing model rather than admitting a capture that cannot prepare', () => {
    const options = submissionOptions();
    const submission = submitRecordDeletion({ ...options, before: { ...options.before, dataModels: {} } });
    expect(submission.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(options.capture.start).not.toHaveBeenCalled();
  });

  it('preflights induced sorting against unfinished entry protections without publishing it', () => {
    const options = submissionOptions(true);
    options.validate.mockReturnValue({ ok: false, reason: 'pending-model-transition' });
    const submission = submitRecordDeletion({ ...options, hasUnfinishedEntries: () => true });
    const validated = options.validate.mock.calls[0]!;
    expect(validated[1].documents.sheet.content.rows).toEqual([...options.before.documents.sheet!.content.rows.slice(1)].reverse());
    expect(validated[2]).toBe(true);
    expect(options.before.documents.sheet!.content.rows[0]).toBe(options.rowId);
    expect(submission.result).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(options.capture.start).not.toHaveBeenCalled();
  });

  it('preserves the ordinary-row and API-free routes', () => {
    const options = submissionOptions();
    submitRecordDeletion({ ...options, enabled: false });
    submitRecordDeletion({ ...options, sheetId: 'other' });
    expect(options.local.mock.calls).toEqual([['sheet', options.rowId, undefined], ['other', options.rowId, undefined]]);
    expect(options.capture.start).not.toHaveBeenCalled();
  });
});
