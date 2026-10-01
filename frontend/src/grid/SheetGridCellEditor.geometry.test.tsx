import { Profiler } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SheetGridCellEditor } from './SheetGridCellEditor';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('tracks transform-only position and size without React commits or duplicate reads', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const observerCallback = vi.fn();
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observerCallback.mockImplementation(callback); }
    observe = observe;
    disconnect = disconnect;
  });
  const anchor = { current: document.createElement('div') };
  const measure = vi.spyOn(anchor.current, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 90, 26));
  const interaction = { cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() };
  let commits = 0;
  const component = (draft: string) => <Profiler id="editor" onRender={() => commits++}>
    <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs" interaction={interaction}
      editingCell={{ target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft }} />
  </Profiler>;
  const view = render(component('Draft'));
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
  editor.setSelectionRange(1, 3);
  measure.mockClear(); commits = 0;
  const step = () => act(() => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
  for (let frame = 0; frame < 120; frame++) step();
  expect(measure).toHaveBeenCalledTimes(120);
  expect(commits).toBe(0);
  measure.mockClear();
  for (let frame = 1; frame <= 5; frame++) {
    measure.mockReturnValue(new DOMRect(40 + frame * 10, 60 + frame * 10, 90 + frame * 10, 26 + frame));
    step();
    expect(editor).toHaveStyle({ left: `${40 + frame * 10}px`, top: `${60 + frame * 10}px`, height: `${26 + frame}px` });
    expect(editor.style.width).toContain(`${90 + frame * 10}px`);
  }
  expect(measure).toHaveBeenCalledTimes(5);
  expect(commits).toBe(0);
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor).toHaveFocus();
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 3]);
  expect(editor.style.maxWidth).toContain('102px');

  view.rerender(component('Updated draft\nsecond line'));
  expect(editor).toHaveValue('Updated draft\nsecond line');
  expect(editor).toHaveAttribute('data-multiline-editor', 'true');
  expect(editor).toHaveStyle({ left: '90px', top: '110px' });
  measure.mockReturnValue(new DOMRect(100, 120, 150, 32));
  act(() => observerCallback([], {}));
  expect(editor).toHaveStyle({ left: '100px', top: '120px', height: '32px' });
  expect(observe).toHaveBeenCalledWith(anchor.current);
  view.unmount();
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalledOnce();
  measure.mockClear();
  fireEvent.scroll(window);
  fireEvent.resize(window);
  expect(measure).not.toHaveBeenCalled();
});

it('keeps the portal mounted while an anchor ref is temporarily detached or replaced', () => {
  const element = document.createElement('div');
  const anchor: { current: HTMLElement | null } = { current: element };
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 60, 90, 26));
  const component = () => <SheetGridCellEditor anchor={anchor} cellKey="A1" sheetName="Inputs"
    interaction={{ cancel: vi.fn(), commit: vi.fn(), commitAndNavigate: vi.fn(), updateValue: vi.fn() }}
    editingCell={{ target: { sheetId: 'inputs', cell: { rowId: 'r1', columnId: 'c1' } }, draft: 'Draft' }} />;
  const view = render(component());
  const editor = screen.getByRole('textbox');
  anchor.current = null;
  view.rerender(component());
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor).toHaveFocus();
  anchor.current = document.createElement('div');
  vi.spyOn(anchor.current, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 100, 120, 32));
  view.rerender(component());
  expect(editor).toHaveStyle({ left: '80px', top: '100px', height: '32px' });
  expect(editor).toHaveFocus();
});
