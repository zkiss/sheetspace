import { describe, expect, it, vi } from 'vitest';
import { detectPlatform, dispatchShortcut, matchesNativeClipboard, matchesShortcut, shortcutLabel, type KeyboardInput, type Keymap } from './keymap';

function event(key: string, modifiers: Partial<KeyboardInput> = {}): KeyboardInput {
  return { key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('platform detection', () => {
  it('prefers user agent data and falls back to the platform', () => {
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('other');
    expect(detectPlatform({ platform: 'MacIntel' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: '' }, platform: 'Linux x86_64' })).toBe('other');
    expect(detectPlatform({})).toBe('other');
  });
  it('works without a browser navigator', () => {
    vi.stubGlobal('navigator', undefined);
    try { expect(detectPlatform()).toBe('other'); } finally { vi.unstubAllGlobals(); }
  });
});

describe('shortcut matching', () => {
  it('accepts only the native primary modifier, without extra modifiers', () => {
    expect(matchesShortcut(event('Z', { metaKey: true }), 'undo', 'mac')).toBe(true);
    expect(matchesShortcut(event('z', { ctrlKey: true }), 'undo', 'mac')).toBe(false);
    expect(matchesShortcut(event('z', { ctrlKey: true }), 'undo', 'other')).toBe(true);
    expect(matchesShortcut(event('z', { metaKey: true }), 'undo', 'other')).toBe(false);
    expect(matchesShortcut(event('z', { ctrlKey: true, metaKey: true }), 'undo', 'other')).toBe(false);
    expect(matchesShortcut(event('z', { ctrlKey: true, altKey: true }), 'undo', 'other')).toBe(false);
    expect(matchesShortcut(event('z', { ctrlKey: true, shiftKey: true }), 'undo', 'other')).toBe(false);
    expect(matchesShortcut(event('z'), 'unknown', 'other')).toBe(false);
  });
  it('resolves redo alternatives for each platform', () => {
    expect(matchesShortcut(event('y', { ctrlKey: true }), 'redo', 'other')).toBe(true);
    expect(matchesShortcut(event('Z', { ctrlKey: true, shiftKey: true }), 'redo', 'other')).toBe(true);
    expect(matchesShortcut(event('Z', { metaKey: true, shiftKey: true }), 'redo', 'mac')).toBe(true);
    expect(matchesShortcut(event('y', { metaKey: true }), 'redo', 'mac')).toBe(false);
  });
  it('matches shifted formatting digits by physical code', () => {
    expect(matchesShortcut(event('!', { code: 'Digit1', ctrlKey: true, shiftKey: true }), 'format-number', 'other')).toBe(true);
    expect(matchesShortcut(event('1', { code: 'Digit2', ctrlKey: true, shiftKey: true }), 'format-number', 'other')).toBe(false);
  });
  it('keeps native clipboard chords and labels when app alternatives change', () => {
    const map: Keymap = { copy: [{ key: 'q', mod: true }] };
    expect(shortcutLabel('copy', 'mac', map)).toBe('⌘+C / ⌘+Q');
    expect(shortcutLabel('copy', 'other', {})).toBe('Ctrl+C');
    expect(matchesNativeClipboard(event('c', { metaKey: true }), 'copy', 'mac')).toBe(true);
    expect(matchesNativeClipboard(event('c', { ctrlKey: true }), 'copy', 'mac')).toBe(false);
    expect(matchesNativeClipboard(event('q', { ctrlKey: true }), 'copy', 'other')).toBe(false);
    expect(matchesNativeClipboard(event('c', { ctrlKey: true }), 'undo', 'other')).toBe(false);
    expect(matchesShortcut(event('q', { ctrlKey: true }), 'copy', 'other', map)).toBe(true);
  });
});

describe('shortcut labels and dispatch', () => {
  it('displays only active platform bindings and no label for unbound actions', () => {
    expect(shortcutLabel('redo', 'mac')).toBe('⌘+Shift+Z');
    expect(shortcutLabel('redo', 'other')).toBe('Ctrl+Y / Ctrl+Shift+Z');
    expect(shortcutLabel('format-number', 'other')).toBe('Ctrl+Shift+1');
    expect(shortcutLabel('unknown', 'mac')).toBeUndefined();
  });
  it('dispatches a newly bound registered action with the current context', () => {
    const map: Keymap = { 'previously-unbound': [{ key: 'q', mod: true }] };
    const run = vi.fn();
    const commands = [{ id: 'previously-unbound', run }];
    const context = { selection: 'A1' };
    expect(dispatchShortcut(event('q', { ctrlKey: true }), commands, context, 'other', map)).toBe(true);
    expect(run).toHaveBeenCalledWith(context);
    expect(dispatchShortcut(event('q', { ctrlKey: true }), commands, context, 'other', {})).toBe(false);
  });
  it('skips unavailable and missing commands', () => {
    const run = vi.fn();
    expect(dispatchShortcut(event('z', { ctrlKey: true }), [{ id: 'undo', unavailable: 'Nothing to undo', run }], {}, 'other')).toBe(false);
    expect(dispatchShortcut(event('z', { ctrlKey: true }), [], {}, 'other')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
