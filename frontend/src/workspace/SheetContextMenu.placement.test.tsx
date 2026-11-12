import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetContextMenu } from './SheetContextMenu';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('clamps both axes and tracks content and viewport changes without losing the editor', () => {
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  let width = 200;
  let height = 100;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height } as DOMRect));
  const sheet = sheetDocument({ id: 'a', name: 'A' });
  const props = { sheet, menu: { sheetId: sheet.id, x: 790, y: 590 }, onSetScale: vi.fn(), onAppendColumn: vi.fn(), onAppendRow: vi.fn(), onChangeZOrder: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), sorting: { apply: vi.fn() } };
  const { rerender, unmount } = render(<SheetContextMenu {...props} />);
  const menu = screen.getByRole('menu', { name: 'A sheet menu' });
  expect(menu).toHaveStyle({ left: '600px', top: '500px' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sorting…' }));
  const add = screen.getByRole('button', { name: 'Add criterion' });
  expect(add).toHaveFocus();
  width = 300; height = 400;
  act(() => resized());
  expect(menu).toHaveStyle({ left: '500px', top: '200px' });
  expect(add).toHaveFocus();
  vi.stubGlobal('innerWidth', 250); vi.stubGlobal('innerHeight', 300);
  fireEvent(window, new Event('resize'));
  expect(menu).toHaveStyle({ left: '0px', top: '0px' });
  rerender(<SheetContextMenu {...props} menu={{ ...props.menu, x: -50, y: -20 }} />);
  expect(menu).toHaveStyle({ left: '0px', top: '0px' });
  expect(add).toHaveFocus();
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
