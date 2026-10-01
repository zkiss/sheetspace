import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { smallSheetDocument } from '@test-support/workbookFactories';
import { SheetContextMenu } from './SheetContextMenu';
import { useWorkspaceController } from './useWorkspaceController';

describe('percentage menu native ownership and completion', () => {
  it.each(['Enter', 'Set scale'])('keeps every native descendant and the draft intact before %s', (ending) => {
    const sheet = smallSheetDocument({ id: 'inputs', name: 'Inputs' });
    const actions = { onAppendColumn: vi.fn(), onAppendRow: vi.fn(), onChangeZOrder: vi.fn(),
      onDelete: vi.fn(), onRename: vi.fn(), onSetScale: vi.fn() };
    const create = vi.fn();
    const clear = vi.fn();
    let controller: ReturnType<typeof useWorkspaceController>;
    function Harness() {
      controller = useWorkspaceController({ onCreateSheet: create, onClearSelection: clear });
      return <section ref={controller.workspaceSurfaceRef} onContextMenu={controller.handleWorkspaceContextMenu}>
        <SheetContextMenu menu={{ sheetId: sheet.id, x: 40, y: 60 }} sheet={sheet} {...actions} />
      </section>;
    }
    render(<Harness />);
    const menu = screen.getByRole('menu');
    const input = within(menu).getByRole<HTMLInputElement>('spinbutton');
    input.focus();
    fireEvent.change(input, { target: { value: '75' } });
    const targets = [input, menu, input.parentElement!, within(menu).getByText('%'),
      within(menu).getByText('Display scale'), within(menu).getByLabelText('Display scale'),
      within(menu).getByRole('button', { name: 'Set scale' }), within(menu).getByRole('menuitem', { name: 'Rename' })];
    for (const target of targets) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByRole('menu')).toBe(menu);
      expect(within(menu).getByRole('spinbutton')).toBe(input);
      expect(input).toHaveValue(75);
      expect(input).toHaveFocus();
      expect(controller!.viewport).toEqual({ x: 0, y: 0, scale: 1 });
      expect(create).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    }
    if (ending === 'Enter') fireEvent.keyDown(input, { key: 'Enter' });
    else fireEvent.click(within(menu).getByRole('button', { name: 'Set scale' }));
    expect(actions.onSetScale).toHaveBeenCalledOnce();
    expect(actions.onSetScale).toHaveBeenCalledWith('inputs', 0.75);
    expect(create).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
