import { describe, expect, it } from 'vitest';
import { keymap, type KeyboardInput } from '@shared/keyboard/keymap';
import { gridNavigationRequest } from './sheetGridModel';

function event(key: string, modifiers: Partial<KeyboardInput> = {}): KeyboardInput {
  return { key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('semantic grid shortcuts', () => {
  it.each(['mac', 'other'] as const)('maps defaults and rejects foreign and extra modifiers on %s', (platform) => {
    const native = platform === 'mac' ? { metaKey: true } : { ctrlKey: true };
    const foreign = platform === 'mac' ? { ctrlKey: true } : { metaKey: true };
    expect(gridNavigationRequest(event('ArrowDown'), platform)).toEqual({ key: 'ArrowDown', command: false, shift: false });
    expect(gridNavigationRequest(event('ArrowLeft', { ...native, shiftKey: true }), platform)).toEqual({ key: 'ArrowLeft', command: true, shift: true });
    expect(gridNavigationRequest(event('Home', native), platform)).toEqual({ key: 'Home', command: true, shift: false });
    expect(gridNavigationRequest(event('Tab', { shiftKey: true }), platform)).toEqual({ key: 'Tab', command: false, shift: true });
    expect(gridNavigationRequest(event('Enter', { shiftKey: true }), platform)).toEqual({ key: 'Enter', command: false, shift: true });
    expect(gridNavigationRequest(event('ArrowLeft', foreign), platform)).toBeUndefined();
    expect(gridNavigationRequest(event('ArrowLeft', { ...native, altKey: true }), platform)).toBeUndefined();
  });

  it('keeps direction, jump and selection semantics when chords are rebound', () => {
    const map = { ...keymap, 'grid-down-jump-select': [{ key: 'q', alt: true }], 'grid-previous': [{ key: 'F8' }] };
    expect(gridNavigationRequest(event('q', { altKey: true }), 'other', map)).toEqual({ key: 'ArrowDown', command: true, shift: true });
    expect(gridNavigationRequest(event('F8'), 'other', map)).toEqual({ key: 'Tab', command: false, shift: true });
    expect(gridNavigationRequest(event('ArrowDown', { ctrlKey: true, shiftKey: true }), 'other', map)).toBeUndefined();
  });
});
