import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { SheetContextMenu } from './SheetContextMenu';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('clamps both axes and invokes the separate sorting action', () => {
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
  const props = { sheet, menu: { sheetId: sheet.id, x: 790, y: 590 }, onSetScale: vi.fn(), onAppendColumn: vi.fn(), onAppendRow: vi.fn(), onChangeZOrder: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), onSort: vi.fn() };
  const { rerender, unmount } = render(<SheetContextMenu {...props} />);
  const menu = screen.getByRole('menu', { name: 'A sheet menu' });
  expect(menu).toHaveStyle({ left: '600px', top: '500px' });
  const sort = screen.getByRole('menuitem', { name: 'Sort…' });
  sort.focus();
  fireEvent.click(sort);
  expect(props.onSort).toHaveBeenCalledOnce();
  width = 300; height = 400;
  act(() => resized());
  expect(menu).toHaveStyle({ left: '500px', top: '200px' });
  expect(sort).toHaveFocus();
  vi.stubGlobal('innerWidth', 250); vi.stubGlobal('innerHeight', 300);
  fireEvent(window, new Event('resize'));
  expect(menu).toHaveStyle({ left: '0px', top: '0px' });
  expect(sort).toHaveFocus();
  rerender(<SheetContextMenu {...props} menu={{ ...props.menu, x: -50, y: -20 }} />);
  expect(menu).toHaveStyle({ left: '0px', top: '0px' });
  expect(sort).toHaveFocus();
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
