import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import type { DataModel } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

it('publishes draft changes and feedback without changing the workbook', () => {
  const model: DataModel = { id: 'm', name: 'Model', columns: [{ id: 'n', name: 'Number', kind: 'manual', type: 'int' }] };
  const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 1, columnCount: 1 });
  const initial = { ...workbookWithSheets([sheet]), dataModels: { m: model } };
  const bound = bindSheetToModel(initial, 's', 'm', () => 'new');
  if (!bound.ok) throw new Error(bound.reason);
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: bound.value }));
  act(() => result.current.commands.changeEntryField('s', 'n', '1e'));
  expect(result.current.entrySessions.s?.draft.fields.n?.invalid).toBe(false);
  act(() => result.current.commands.leaveEntryField('s', 'n'));
  expect(result.current.entrySessions.s?.draft.fields.n?.invalid).toBe(true);
  act(() => result.current.commands.dismissEntryFeedback('s', 'n'));
  expect(result.current.entrySessions.s?.draft.fields.n).toEqual({ raw: '1e', invalid: true });
  expect(result.current.workbook).toBe(bound.value);
});
