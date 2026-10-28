import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

export function navigateFirstReference(source: HTMLElement, editorName: string) {
  fireEvent.keyDown(source, { key: 'F2' });
  const editor = screen.getByRole('textbox', { name: editorName });
  const token = document.querySelector<HTMLElement>('[data-reference-index="0"]');
  if (!token) throw new Error('Missing reference token');
  vi.spyOn(token, 'getClientRects').mockReturnValue([{ left: 10, right: 100, top: 10, bottom: 30 } as DOMRect] as unknown as DOMRectList);
  const event = { clientX: 20, clientY: 20, ctrlKey: true };
  fireEvent.mouseMove(editor, event);
  fireEvent.mouseDown(editor, event);
}
