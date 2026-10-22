import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('navigation palette composition', () => {
  it('opens from the visible launcher, browses sheets, and returns focus on escape', async () => {
    const user = userEvent.setup();
    const sheet = sheetDocument({ id: 'alpha', name: 'Alpha' });
    render(<App initialWorkbook={workbookWithSheets([sheet])} />);
    const launcher = screen.getByRole('button', { name: 'Command palette' });
    await user.click(launcher);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to sheet: Alpha' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });
});
