import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export function workspaceSurface() {
  return screen.getByTestId('workspace-surface');
}

export async function createSheetFromToolbar(name: string) {
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: /new sheet/i }));
  await user.type(screen.getByLabelText(/sheet name/i), name);
  await user.click(screen.getByRole('button', { name: /^create$/i }));
}

export async function openCellEditor(user: ReturnType<typeof userEvent.setup>, cell: HTMLElement) {
  await user.dblClick(cell);
  return within(cell).getByRole('textbox');
}

export function openSheetContextMenu(frame: HTMLElement, clientX = 120, clientY = 80) {
  fireEvent.contextMenu(frame, { clientX, clientY });
  return screen.getByRole('menu');
}

export function resizeHandle(frame: HTMLElement, handle: string) {
  const match = within(frame)
    .getAllByTestId('sheet-frame-resize-handle')
    .find((candidate) => candidate.dataset.resizeHandle === handle);
  if (!match) {
    throw new Error(`Missing resize handle ${handle}`);
  }

  return match;
}

