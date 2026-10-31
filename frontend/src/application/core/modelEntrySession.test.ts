import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkbook } from '@workbook/mutations/operations';
import type { DataModel, SheetDocument } from '@workbook/core/model';
import { ModelEntrySessions } from './modelEntrySession';

const model: DataModel = { id: 'm', name: 'Model', columns: [
  { id: 'n', name: 'Number', kind: 'manual', type: 'int' },
  { id: 'c', name: 'Calculated', kind: 'calculated', type: 'int', formula: '=1' },
] };
const workbook = createEmptyWorkbook();
const sheet = {} as SheetDocument;

describe('entry sessions', () => {
  it('keeps independent drafts and validates before admission', async () => {
    const sessions = new ModelEntrySessions();
    sessions.change('a', model, 'n', '1e', workbook);
    sessions.change('b', model, 'n', '2', workbook);
    const admit = vi.fn();
    expect(await sessions.submit('a', model, workbook, 1, () => 'id', admit)).toEqual({ firstInvalid: 'n' });
    expect(admit).not.toHaveBeenCalled();
    sessions.dismiss('a', model, 'n');
    expect(sessions.get('a', model).draft.fields.n).toEqual({ raw: '1e', invalid: true });
    expect(sessions.get('b', model).draft.fields.n?.raw).toBe('2');
    sessions.leave('a', model, 'n', workbook);
    sessions.change('a', model, 'n', '3', workbook);
    expect(sessions.get('a', model).draft.fields.n?.invalid).toBe(false);
    sessions.remove('a');
    expect(sessions.get('a', model).draft.fields.n?.raw).toBe('');
  });

  it('blocks duplicate submissions and retries the identical snapshot after failure', async () => {
    const sessions = new ModelEntrySessions();
    sessions.change('a', model, 'n', '12', workbook);
    let reject!: (error: Error) => void;
    const admit = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValueOnce({ rowId: 'id', sheet });
    const first = sessions.submit('a', model, workbook, 4, () => 'id', admit);
    expect(sessions.get('a', model).pending).toBe(true);
    expect(await sessions.submit('a', model, workbook, 4, () => 'other', admit)).toEqual({});
    sessions.change('a', model, 'n', '99', workbook);
    reject(new Error('offline'));
    await first;
    expect(sessions.get('a', model).failure).toBe('offline');
    sessions.change('a', model, 'n', '99', workbook);
    expect(sessions.get('a', model).draft.fields.n?.raw).toBe('12');
    expect(await sessions.submit('a', model, workbook, 9, () => 'other', admit)).toEqual({ result: { rowId: 'id', sheet } });
    expect(admit.mock.calls[0]).toEqual([{ rowId: 'id', revision: 4, values: { n: '12' } }]);
    expect(admit.mock.calls[1]).toEqual(admit.mock.calls[0]);
    expect(sessions.get('a', model).draft.fields.n?.raw).toBe('');
  });

  it('does not carry field input into a changed model shape', () => {
    const sessions = new ModelEntrySessions();
    sessions.change('a', model, 'n', '7', workbook);
    const changed: DataModel = { ...model, columns: [{ id: 'n', name: 'Number', kind: 'manual', type: 'string' }] };
    expect(sessions.get('a', changed).draft.fields.n?.raw).toBe('');
  });
});
