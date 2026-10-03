import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { NumberFormatControls } from './NumberFormatControls.testHarness';

afterEach(() => vi.restoreAllMocks());

describe('responsive colour palette containment', () => {
  it('clamps at either viewport edge and repositions as the toolbar wraps or scrolls', () => {
    let triggerLeft = 280;
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: this.classList.contains('colour-picker') ? triggerLeft : 0, width: 288 } as DOMRect;
    });
    const sheet = sheetDocument({ id: 'palette-position', name: 'Palette position', rowCount: 1, columnCount: 1 });
    const endpoint = { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } };
    const { unmount } = render(<NumberFormatControls sheet={sheet} selection={{ mode: 'cells', anchor: endpoint, extent: endpoint }} onWrite={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fill colour: inherited' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.getPropertyValue('--colour-popover-offset')).toBe('-260px');
    triggerLeft = 4;
    fireEvent(window, new Event('resize'));
    expect(dialog.style.getPropertyValue('--colour-popover-offset')).toBe('8px');
    triggerLeft = 16;
    fireEvent(window, new Event('scroll'));
    expect(dialog.style.getPropertyValue('--colour-popover-offset')).toBe('0px');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });
});
