import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setup } from '@test-support/workspaceActionCommands';

describe('workspace palette actions', () => {
  it('opens Functions and sorting for the selected sheet from the palette', () => {
    const { command, hook, props, sheet } = setup();
    props.onOpenFunctions = vi.fn();
    props.onSortSheet = vi.fn();
    hook.rerender();
    expect(command('functions').unavailable).toBeUndefined();
    expect(command('sort-sheet').unavailable).toBeUndefined();
    act(() => command('functions').run());
    act(() => command('sort-sheet').run());
    expect(props.onOpenFunctions).toHaveBeenCalledOnce();
    expect(props.onSortSheet).toHaveBeenCalledWith(sheet.id);
    expect(props.closePalette).toHaveBeenCalledWith(false);
  });

  it('makes sorting unavailable without a selected sheet', () => {
    const { command, hook, props } = setup();
    props.sheet = undefined;
    props.onSortSheet = vi.fn();
    hook.rerender();
    expect(command('sort-sheet').unavailable).toBe('Select a sheet first');
  });

});
