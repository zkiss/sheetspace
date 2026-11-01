import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ErrorReferencePreview } from './ErrorReferencePreview';
import { errorCellText } from './errorCellText';
import type { WorkbookError } from './workbookErrors';

it('projects the hovered element into the workspace portal and stops tracking on unmount', () => {
  const callbacks: FrameRequestCallback[] = [];
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const surface = document.createElement('div');
  const element = document.createElement('span');
  surface.getBoundingClientRect = () => ({ left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100, x: 10, y: 20, toJSON: () => ({}) });
  element.getBoundingClientRect = () => ({ left: 30, top: 40, right: 50, bottom: 60, width: 20, height: 20, x: 30, y: 40, toJSON: () => ({}) });
  const error: WorkbookError = { key: 'e', sheetId: 's', cell: { rowId: 'r', columnId: 'c' }, reference: '@S!A[1]', code: '#REF!', text: 'Missing' };
  const reference = errorCellText(error, 0).references[0];
  const view = render(<ErrorReferencePreview hover={{ reference, element, color: 'red' }} surface={surface} geometry={{ kind: 'visible', rect: { left: 100, top: 20, right: 120, bottom: 40 } }} onNavigate={vi.fn()} />);
  expect(screen.getByLabelText('Formula reference paths')).toBeInTheDocument();
  act(() => callbacks[0](0));
  view.unmount();
  expect(cancel).toHaveBeenCalledWith(2);
  frame.mockRestore();
  cancel.mockRestore();
});
