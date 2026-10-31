import { describe, expect, it } from 'vitest';
import { createEmptyWorkbook } from '@workbook/mutations/operations';
import type { DataModel } from '@workbook/core/model';
import { changeEntryField, createModelEntryDraft, dismissEntryFeedback, leaveEntryField, validateEntryDraft } from './modelEntryDraft';

const model: DataModel = { id: 'model', name: 'Model', columns: [
  { id: 'number', name: 'Number', kind: 'manual', type: 'int' },
  { id: 'text', name: 'Text', kind: 'manual', type: 'string' },
  { id: 'formula', name: 'Formula', kind: 'calculated', type: 'float', formula: '=1' },
] };
const workbook = createEmptyWorkbook();

describe('model entry drafts', () => {
  it('delays feedback until leave, retains dismissed input, and clears invalid state on correction', () => {
    let draft = createModelEntryDraft(model);
    draft = changeEntryField(draft, model, 'number', '1e', workbook, 'sheet');
    expect(draft.fields.number).toEqual({ raw: '1e', invalid: false });
    draft = leaveEntryField(draft, model, 'number', workbook, 'sheet');
    expect(draft.fields.number).toEqual({ raw: '1e', invalid: true, message: 'Enter a valid int value.' });
    draft = dismissEntryFeedback(draft, 'number');
    expect(draft.fields.number).toEqual({ raw: '1e', invalid: true });
    draft = changeEntryField(draft, model, 'number', '12', workbook, 'sheet');
    expect(draft.fields.number).toEqual({ raw: '12', invalid: false });
  });

  it('validates in declaration order without requiring blank values or accepting calculated edits', () => {
    let draft = createModelEntryDraft(model);
    expect(validateEntryDraft(draft, model, workbook, 'sheet').firstInvalid).toBeUndefined();
    expect(changeEntryField(draft, model, 'formula', 'x', workbook, 'sheet')).toBe(draft);
    draft = changeEntryField(draft, model, 'number', '1.5', workbook, 'sheet');
    draft = changeEntryField(draft, model, 'text', '42', workbook, 'sheet');
    const result = validateEntryDraft(draft, model, workbook, 'sheet');
    expect(result.firstInvalid).toBe('number');
    expect(result.draft.fields.text?.invalid).toBe(true);
  });
});
