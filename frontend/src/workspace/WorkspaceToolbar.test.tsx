import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceToolbar } from './WorkspaceToolbar';

describe('compact workspace toolbar', () => {
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
