import { fireEvent, screen } from '@testing-library/react';
import { openSheetContextMenu, workspaceSurface } from './appScreen';

/** Exercise native wheel zoom with the same factor as one former toolbar step. */
export function zoomWorkspace(direction: 'in' | 'out', times = 1) {
  const surface = workspaceSurface();
  const rect = surface.getBoundingClientRect();
  for (let index = 0; index < times; index += 1) {
    fireEvent.wheel(surface, {
      ctrlKey: true,
      deltaY: (direction === 'in' ? -1 : 1) * Math.log(1.2) * 500,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
  }
}

export function setSheetScale(frame: HTMLElement, percentage: number) {
  openSheetContextMenu(frame);
  const input = screen.getByRole('spinbutton', { name: 'Display scale percentage' });
  fireEvent.change(input, { target: { value: String(percentage) } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** Pan back to the origin and undo the current zoom without removed UI controls. */
export function resetWorkspaceViewport() {
  const surface = workspaceSurface();
  const scale = Number(surface.dataset.viewportScale);
  if (scale !== 1) fireEvent.wheel(surface, { ctrlKey: true, deltaY: Math.log(scale) * 500 });
  fireEvent.wheel(surface, {
    deltaX: Number(surface.dataset.viewportX),
    deltaY: Number(surface.dataset.viewportY),
  });
}

export function applyCustomColour(label: 'Text colour' | 'Fill colour', colour: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole('button', { name: 'Add custom colour' }));
  fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: colour } });
  fireEvent.click(screen.getByRole('button', { name: `Use ${colour}` }));
}
