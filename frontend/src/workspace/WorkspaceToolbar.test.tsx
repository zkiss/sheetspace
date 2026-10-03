import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import { NumberFormatControls } from './NumberFormatControls.testHarness';

describe('compact workspace toolbar', () => {
  it('orders four cohesive formatting groups after creation, keeping precision and resets with their properties', () => {
    render(<WorkspaceToolbar canRetryFailedSaves={false} saveStatus="saved" onCreateSheet={vi.fn()} onRetryFailedSaves={vi.fn()}
      formatControls={<NumberFormatControls sheet={undefined} selection={null} onWrite={vi.fn()} />} />);
    const toolbar = screen.getByRole('banner', { name: 'Workspace controls' });
    const groups = within(toolbar).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Number format', 'Bold formatting', 'Horizontal alignment', 'Colours']);
    const [format, bold, alignment, colours] = groups;
    expect(within(format).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['General number format', 'Number format', 'Percent format', 'Inherit number format']);
    expect(within(format).getByRole('spinbutton', { name: 'Number format precision' })).toBeInTheDocument();
    expect(within(bold).getAllByRole('button')).toHaveLength(2);
    expect(within(bold).getByRole('button', { name: 'Inherit bold setting' })).toBeInTheDocument();
    expect(within(alignment).getAllByRole('button')).toHaveLength(5);
    expect(within(alignment).getByRole('button', { name: 'Inherit horizontal alignment' })).toBeInTheDocument();
    expect(within(colours).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Text colour: mixed', 'Fill colour: mixed']);
    expect(toolbar.firstElementChild).toBe(within(toolbar).getByRole('button', { name: 'New sheet' }));
    expect(toolbar.lastElementChild).toContainElement(within(toolbar).getByRole('status', { name: 'All changes saved' }));
    for (const group of groups) {
      expect(group).toHaveClass('format-control-group');
      expect(group).not.toHaveAttribute('tabindex');
    }
    expect(within(toolbar).queryByRole('separator')).not.toBeInTheDocument();
    expect(toolbar.querySelector('.save-status-indicator')).not.toHaveClass('format-control-group');
  });

  it('exposes create, changing live save status and a keyboard-accessible retry action', () => {
    const props = { onCreateSheet: vi.fn(), onRetryFailedSaves: vi.fn(), canRetryFailedSaves: false, formatControls: <span>Formats</span> };
    const { rerender } = render(<WorkspaceToolbar {...props} saveStatus="saved" />);
    fireEvent.click(screen.getByRole('button', { name: 'New sheet' }));
    expect(props.onCreateSheet).toHaveBeenCalledOnce();
    expect(screen.getByRole('status', { name: 'All changes saved' })).toHaveTextContent('All changes saved');
    rerender(<WorkspaceToolbar {...props} saveStatus="saving" />);
    expect(screen.getByRole('status', { name: 'Saving changes' })).toHaveTextContent('Saving changes');
    rerender(<WorkspaceToolbar {...props} saveStatus="failed" />);
    expect(screen.getByRole('status', { name: 'Save failed' })).toHaveTextContent('Save failed');
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    rerender(<WorkspaceToolbar {...props} saveStatus="failed" canRetryFailedSaves />);
    fireEvent.click(screen.getByRole('button', { name: 'Save failed. Retry changes.' }));
    expect(props.onRetryFailedSaves).toHaveBeenCalledOnce();
  });
});
