import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

const feedback = vi.hoisted(() => ({ reason: undefined as import('@application/react/workbookControllerTypes').WorkbookController['mutationFailure'] }));
vi.mock('@application/react/useWorkbookController', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@application/react/useWorkbookController')>();
  return { ...actual, useWorkbookController: (...args: Parameters<typeof actual.useWorkbookController>) => ({ ...actual.useWorkbookController(...args), mutationFailure: feedback.reason }) };
});

it.each([
  ['pending-model-transition', 'data model change'],
  ['pending-axis-creation', 'row or column creation'],
  ['pending-sheet-creation', 'sheet creation'],
  ['blocked-persistence-prerequisite', 'earlier failed saves'],
  ['sorting-history-too-large', 'too large to undo'],
] as const)('presents actionable feedback for %s', (reason, message) => {
  feedback.reason = reason;
  render(<App initialWorkbook={workbookWithSheets([])} />);
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('alert')).toHaveTextContent('Your change was not applied.');
});
