import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { openSheetContextMenu, workspaceSurface } from '@test-support/appScreen';
import { smallSheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { App } from './App';

function setup() {
  const apiClient = autosaveClient({ updateSheetVisualScale: vi.fn() });
  render(<App apiClient={apiClient} initialWorkbook={workbookWithSheets([
    smallSheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: 'Original' } }),
  ])} />);
  const frame = screen.getByRole('article', { name: 'Sheet Inputs' });
  const cell = within(frame).getByRole('cell', { name: 'Inputs A1 cell' });
  fireEvent.click(cell);
  fireEvent.cut(cell, { clipboardData: { setData: () => undefined } });
  return { apiClient, cell, frame, surface: workspaceSurface() };
}

function openDialog(kind: 'Create' | 'Rename', frame: HTMLElement) {
  if (kind === 'Create') fireEvent.keyDown(document.body, { key: 'N', shiftKey: true });
  else fireEvent.click(within(openSheetContextMenu(frame)).getByRole('menuitem', { name: 'Rename' }));
  const dialog = screen.getByRole('form', { name: `${kind} sheet` });
  expect(within(dialog).getByRole('textbox')).toHaveFocus();
  return dialog;
}

function pointer(target: Element | Window, type: string, { x = 0, y = 0, button = 0, ctrlKey = false } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, button, buttons: button === 1 ? 4 : 1,
    clientX: x, clientY: y, ctrlKey });
  Object.assign(event, { pointerId: 17 });
  fireEvent(target, event);
  return event;
}

function gesture(target: Element, type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 100, clientY: 100 });
  fireEvent(target, event);
}

function capture(element: HTMLElement) {
  let held = false;
  element.setPointerCapture = vi.fn(() => { held = true; });
  element.hasPointerCapture = vi.fn(() => held);
  element.releasePointerCapture = vi.fn(() => { held = false; });
  return element.releasePointerCapture;
}

function viewport(surface: HTMLElement) {
  return [surface.dataset.viewportX, surface.dataset.viewportY, surface.dataset.viewportScale];
}

function previewState(frame: HTMLElement, cell: HTMLElement) {
  return [frame.dataset.positionX, frame.dataset.positionY, frame.dataset.frameWidth, frame.dataset.visualScale,
    cell.style.width, cell.style.height];
}

function expectNoWrites(apiClient: ReturnType<typeof setup>['apiClient']) {
  for (const write of [apiClient.createSheet, apiClient.renameSheet, apiClient.writeCells,
    apiClient.writeNumberFormats, apiClient.writeAxisSizes, apiClient.updateSheetPosition,
    apiClient.updateSheetFrameLayout, apiClient.updateSheetVisualScale]) expect(write).not.toHaveBeenCalled();
}

describe('sheet dialog takeover of armed background owners', () => {
  describe.each(['Create', 'Rename'] as const)('%s', (kind) => {
    it.each(['name', 'submit', 'cancel'])('owns one Escape from %s after Space is armed without keyup', (target) => {
      const { apiClient, cell, frame, surface } = setup();
      fireEvent.keyDown(cell, { key: ' ', code: 'Space' });
      const dialog = openDialog(kind, frame);
      const input = within(dialog).getByRole('textbox');
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: kind === 'Create' ? 'Create' : 'Save' }));
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'Abandoned' } });
      const control = target === 'name' ? input : within(dialog).getByRole('button', {
        name: target === 'cancel' ? 'Cancel' : kind === 'Create' ? 'Create' : 'Save',
      });
      control.focus();
      fireEvent.keyDown(control, { key: 'Escape' });
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
      expect(cell).toHaveAttribute('data-active-cell', 'true');
      expect(cell).toHaveAttribute('data-pending-cut', 'true');
      expect(cell).not.toHaveFocus();
      expectNoWrites(apiClient);

      // A stale held Space cannot hijack a cell pointerdown after dismissal.
      const before = viewport(surface);
      pointer(cell, 'pointerdown');
      pointer(window, 'pointermove', { x: 20, y: 20 });
      pointer(window, 'pointerup', { x: 20, y: 20 });
      expect(viewport(surface)).toEqual(before);
      const reopened = openDialog(kind, frame);
      expect(within(reopened).getByRole('textbox')).toHaveValue(kind === 'Create' ? '' : 'Inputs');
      expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it.each(['palette', 'menu'])('retires simultaneous held Space and %s drafts without background focus restoration', (owner) => {
    const { apiClient, cell, frame } = setup();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    const trigger = screen.getByRole('button', { name: /^Fill colour:/ });
    if (owner === 'palette') {
      trigger.focus();
      fireEvent.click(trigger);
      fireEvent.input(screen.getByLabelText('Custom colour'), { target: { value: '#abcdef' } });
    } else {
      openSheetContextMenu(frame);
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Display scale percentage' }), { target: { value: '50' } });
    }
    const dialog = openDialog('Create', frame);
    expect(screen.queryByRole('dialog', { name: 'Fill colour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expectNoWrites(apiClient);
    if (owner === 'palette') {
      fireEvent.click(trigger);
      expect(screen.getByLabelText('Custom colour')).toHaveValue('#ffffff');
    } else {
      openSheetContextMenu(frame);
      expect(screen.getByRole('spinbutton', { name: 'Display scale percentage' })).toHaveValue(100);
    }
  });
});

describe('sheet dialog takeover of workspace gestures', () => {
  it.each(['pan', 'pinch'])('retires %s, suspends background starts and ignores old continuations after dismissal', (owner) => {
    const { apiClient, frame, surface } = setup();
    const release = capture(surface);
    if (owner === 'pan') {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
      pointer(surface, 'pointerdown');
      pointer(window, 'pointermove', { x: 20, y: 30 });
    } else {
      gesture(surface, 'gesturestart', 1);
      gesture(surface, 'gesturechange', 1.1);
    }
    const before = viewport(surface);
    const dialog = openDialog('Create', frame);
    if (owner === 'pan') expect(release).toHaveBeenCalledWith(17);
    expect(surface).not.toHaveClass('workspace-surface-panning');
    const continueOld = () => {
      pointer(window, 'pointermove', { x: 70, y: 80 });
      pointer(window, 'pointerup', { x: 70, y: 80 });
      gesture(surface, 'gesturechange', 2);
    };
    continueOld();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    pointer(surface, 'pointerdown', { button: 1 });
    gesture(surface, 'gesturestart', 1);
    gesture(surface, 'gesturechange', 3);
    fireEvent.wheel(surface, { deltaY: 50 });
    fireEvent.wheel(surface, { ctrlKey: true, deltaY: -50 });
    expect(viewport(surface)).toEqual(before);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    continueOld();
    expect(viewport(surface)).toEqual(before);
    expect(pointer(surface, 'click').defaultPrevented).toBe(false);
    expectNoWrites(apiClient);

    pointer(surface, 'pointerdown', { button: 1 });
    pointer(window, 'pointermove', { x: 10, y: 10, button: 1 });
    pointer(window, 'pointerup', { button: 1 });
    expect(viewport(surface)).not.toEqual(before);
    const scale = Number(surface.dataset.viewportScale);
    gesture(surface, 'gesturestart', 1);
    gesture(surface, 'gesturechange', 1.1);
    gesture(surface, 'gestureend', 1.1);
    expect(Number(surface.dataset.viewportScale)).toBeCloseTo(scale * 1.1);
  });
});

describe('sheet dialog takeover of pointer previews', () => {
  it.each(['frame drag', 'frame resize', 'frame scale', 'row', 'column'])('discards captured %s and prevents delayed pointerup writes', (owner) => {
    const { apiClient, cell, frame, surface } = setup();
    const target = owner === 'frame drag' ? within(frame).getByTestId('sheet-frame-header')
      : owner.startsWith('frame') ? within(frame).getByRole('separator', { name: 'Resize sheet Inputs from right' })
      : within(frame).getByRole('separator', { name: `Resize ${owner} ${owner === 'row' ? '1' : 'A'}` });
    const release = capture(target);
    const initial = previewState(frame, cell);
    const move = { x: 50, y: 50, ctrlKey: owner === 'frame scale' };
    pointer(target, 'pointerdown', move);
    pointer(target, 'pointermove', { ...move, x: 100, y: 100 });
    expect(previewState(frame, cell)).not.toEqual(initial);
    const dialog = openDialog('Create', frame);
    expect(release).toHaveBeenCalledWith(17);
    expect(previewState(frame, cell)).toEqual(initial);
    pointer(target, 'pointerup', { ...move, x: 150, y: 150 });
    pointer(target, 'pointerdown', move);
    pointer(target, 'pointermove', { ...move, x: 150, y: 150 });
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    pointer(target, 'pointerup', { ...move, x: 150, y: 150 });
    expect(previewState(frame, cell)).toEqual(initial);
    expect(cell).toHaveAttribute('data-active-cell', 'true');
    expect(cell).toHaveAttribute('data-pending-cut', 'true');
    expect(viewport(surface)).toEqual(['0', '0', '1']);
    expectNoWrites(apiClient);

    // New sessions still preview normally; cancellation never revives the old draft.
    pointer(target, 'pointerdown', move);
    pointer(target, 'pointermove', { ...move, x: 100, y: 100 });
    expect(previewState(frame, cell)).not.toEqual(initial);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    pointer(target, 'pointerup', { ...move, x: 100, y: 100 });
    expectNoWrites(apiClient);
  });
});
