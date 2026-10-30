import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { measuredElementGeometry, virtualGridGeometry } from '@test-support/domGeometry';
import { workspaceSurface } from '@test-support/appScreen';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';
import { prepareCellInput } from '@application/core/cellInputPreparation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('does not navigate to a same-name replacement when inspecting a dead reference', () => {
  const old = sheetDocument({ id: 'old', name: 'Inputs' });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const original = workbookWithSheets([old, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', original, outputs.id);
  const replacement = sheetDocument({ id: 'replacement', name: 'Inputs' });
  render(<App initialWorkbook={workbookWithSheets([replacement, outputs])} />);
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  expect(editor).toHaveValue('=#REF!');
  editor.setSelectionRange(2, 2);
  fireEvent.keyDown(editor, { key: 'F4' });
  expect(editor).toHaveFocus();
});

it('retains the outgoing offscreen sheet only for the normal selection fade', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4000, y: 3000 } });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const workbook = workbookWithSheets([inputs, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', workbook, outputs.id);
  render(<App initialWorkbook={workbook} />);
  act(() => { measuredElementGeometry(workspaceSurface(), { width: 800, height: 600 }); });
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  editor.setSelectionRange(5, 5);
  fireEvent.keyDown(editor, { key: 'F4' });
  expect(screen.getByRole('article', { name: 'Sheet Outputs' })).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.queryByRole('article', { name: 'Sheet Outputs' })).not.toBeInTheDocument();
});

it('does not retain the offscreen source for a reduced-motion selection transition', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4000, y: 3000 } });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const workbook = workbookWithSheets([inputs, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', workbook, outputs.id);
  render(<App initialWorkbook={workbook} />);
  act(() => { measuredElementGeometry(workspaceSurface(), { width: 800, height: 600 }); });
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  editor.setSelectionRange(5, 5);
  fireEvent.keyDown(editor, { key: 'F4' });
  expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveFocus();
  expect(screen.queryByRole('article', { name: 'Sheet Outputs' })).not.toBeInTheDocument();
});

it('interrupts an F4 reference jump with Back and restores the source draft', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4000, y: 3000 } });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const workbook = workbookWithSheets([inputs, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', workbook, outputs.id);
  render(<App initialWorkbook={workbook} />);
  act(() => { measuredElementGeometry(workspaceSurface(), { width: 800, height: 600 }); });
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  fireEvent.change(editor, { target: { value: '=@Inputs!B[2]+1' } });
  editor.setSelectionRange(5, 5);
  fireEvent.keyDown(editor, { key: 'F4' });
  expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole('cell', { name: 'Outputs A1 cell' })).toHaveAttribute('data-active-cell', 'true');
  fireEvent.keyDown(screen.getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'F2' });
  expect(screen.getByRole('textbox', { name: 'Outputs A1 editor' })).toHaveValue('=@Inputs!B[2]+1');
});

it('follows a modifier-clicked editor reference and restores its suspended draft', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 400, y: 20 } });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const workbook = workbookWithSheets([inputs, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', workbook, outputs.id);
  render(<App initialWorkbook={workbook} />);
  act(() => { measuredElementGeometry(workspaceSurface(), { width: 800, height: 600 }); });
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  fireEvent.change(editor, { target: { value: '=@Inputs!B[2]+1' } });
  act(() => {
    for (const name of ['Inputs', 'Outputs']) {
      virtualGridGeometry(within(screen.getByRole('article', { name: `Sheet ${name}` })).getByTestId('sheet-frame-body'), { width: 238, height: 126 });
    }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Show references' }));
  expect(screen.getByRole('button', { name: 'Navigate to @Inputs!B[2]' })).toBeInTheDocument();
  const token = document.querySelector<HTMLElement>('[data-reference-index="0"]')!;
  vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);
  fireEvent.mouseMove(editor, { clientX: 20, clientY: 20, ctrlKey: true });
  fireEvent.mouseDown(editor, { clientX: 20, clientY: 20, ctrlKey: true });
  expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.keyDown(screen.getByRole('cell', { name: 'Outputs A1 cell' }), { key: 'F2' });
  expect(screen.getByRole('textbox', { name: 'Outputs A1 editor' })).toHaveValue('=@Inputs!B[2]+1');
});

it('clears the jump highlight when Back interrupts a modifier-click navigation', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', position: { x: 4000, y: 3000 } });
  const outputs = sheetDocument({ id: 'outputs', name: 'Outputs' });
  const workbook = workbookWithSheets([inputs, outputs]);
  outputs.content.cells[cellIdentityKey(cellIdentityAt(outputs.content, 'A1')!)] = prepareCellInput('=@Inputs!B[2]', workbook, outputs.id);
  render(<App initialWorkbook={workbook} />);
  act(() => { measuredElementGeometry(workspaceSurface(), { width: 800, height: 600 }); });
  const source = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  fireEvent.click(source);
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Outputs A1 editor' });
  fireEvent.change(editor, { target: { value: '=@Inputs!B[2]+1' } });
  const token = document.querySelector<HTMLElement>('[data-reference-index="0"]')!;
  vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);
  fireEvent.mouseMove(editor, { clientX: 20, clientY: 20, ctrlKey: true });
  fireEvent.mouseDown(editor, { clientX: 20, clientY: 20, ctrlKey: true });
  expect(screen.getByRole('cell', { name: 'Inputs B2 empty cell' })).toHaveAttribute('data-navigation-highlight', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  act(() => { vi.advanceTimersByTime(2000); });
  expect(document.querySelector('[data-navigation-highlight="true"]')).toBeNull();
  const restored = screen.getByRole('cell', { name: 'Outputs A1 cell' });
  expect(restored).toHaveAttribute('data-active-cell', 'true');
  fireEvent.keyDown(restored, { key: 'F2' });
  expect(screen.getByRole('textbox', { name: 'Outputs A1 editor' })).toHaveValue('=@Inputs!B[2]+1');
});
