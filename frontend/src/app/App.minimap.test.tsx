import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testRect } from '@test-support/domGeometry';
import { workbookWithSheets, smallSheetDocument } from '@test-support/workbookFactories';
import { App } from './App';
import { activateCellEditor } from '@test-support/appScreen';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}

describe('workspace minimap integration', () => {
  it('preserves an active draft and ignores zoom gestures over the map', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      render(<App initialWorkbook={workbookWithSheets([
        smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '7' } }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ])} />);
      const cell = screen.getByRole('cell', { name: 'Inputs A1 cell' });
      activateCellEditor(cell);
      const editor = screen.getByRole('textbox', { name: 'Inputs A1 editor' });
      fireEvent.change(editor, { target: { value: 'draft' } });
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      const surface = screen.getByTestId('workspace-surface');
      fireEvent.wheel(map, { deltaY: -100, ctrlKey: true });
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 180, clientY: 65 });
      expect(editor).toHaveValue('draft');
      expect(editor).toHaveFocus();
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(surface).toHaveAttribute('data-viewport-scale', '1');
    } finally { vi.unstubAllGlobals(); }
  });
  it('navigates the real canvas without zoom and includes virtualized sheets', () => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    try {
      const workbook = workbookWithSheets([
        smallSheetDocument({ id: 'near', name: 'Near' }),
        smallSheetDocument({ id: 'far', name: 'Far', position: { x: 4000, y: 0 } }),
      ]);
      const { unmount } = render(<App initialWorkbook={workbook} />);
      const map = screen.getByRole('img', { name: 'Workspace map' });
      map.getBoundingClientRect = () => testRect({ left: 0, top: 0, width: 200, height: 130 });
      expect(map.querySelectorAll('.workspace-minimap-sheet')).toHaveLength(2);
      const surface = screen.getByTestId('workspace-surface');
      const scale = surface.dataset.viewportScale;
      fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: 180, clientY: 65 });
      expect(Number(surface.dataset.viewportX)).toBeLessThan(-1000);
      expect(surface.dataset.viewportScale).toBe(scale);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
});
