import { describe, expect, it, vi } from 'vitest';
import { detectPlatform, dispatchShortcut, matchesNativeClipboard, matchesShortcut, shortcutAria, shortcutLabel, type KeyboardInput, type Keymap } from './keymap';

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
  it.each([
    ['format-general', '0', 'Digit0'], ['format-number', '1', 'Digit1'], ['format-percent', '5', 'Digit5'],
  ])('matches %s shifted digits by physical code on both platforms', (id, key, code) => {
    for (const [platform, modifier] of [['mac', { metaKey: true }], ['other', { ctrlKey: true }]] as const) {
      expect(matchesShortcut(event('!', { code, ...modifier, shiftKey: true }), id, platform)).toBe(true);
      expect(matchesShortcut(event(key, { code: 'Digit2', ...modifier, shiftKey: true }), id, platform)).toBe(false);
    }
  });
  it.each([
    ['sheet', 'KeyS', 'Í', 'S'], ['column', 'KeyC', 'Ç', 'C'],
    ['row', 'KeyR', '‰', 'R'], ['definition', 'KeyD', 'Î', 'D'],
    ['errors', 'KeyE', 'Dead', 'E'], ['usages', 'KeyU', '¨', 'U'],
  ])('matches macOS Option shortcut %s by physical key and displays its binding', (id, code, key, label) => {
    expect(matchesShortcut(event(key, { code, altKey: true, shiftKey: true }), id, 'mac')).toBe(true);
    expect(matchesShortcut(event(key, { code: 'KeyX', altKey: true, shiftKey: true }), id, 'mac')).toBe(false);
    expect(matchesShortcut(event(key, { code, altKey: true }), id, 'mac')).toBe(false);
    expect(shortcutLabel(id, 'mac')).toBe(`Alt+Shift+${label}`);
  });
  it.each([
    ['sheet', 'S', 'KeyS'], ['column', 'C', 'KeyC'], ['row', 'R', 'KeyR'],
    ['definition', 'D', 'KeyD'], ['errors', 'E', 'KeyE'], ['usages', 'U', 'KeyU'],
  ])('matches other-platform %s by layout letter rather than physical position', (id, key, code) => {
    expect(matchesShortcut(event(key, { code: 'Semicolon', altKey: true, shiftKey: true }), id, 'other')).toBe(true);
    expect(matchesShortcut(event('O', { code, altKey: true, shiftKey: true }), id, 'other')).toBe(false);
    expect(matchesShortcut(event(key, { code, altKey: true }), id, 'other')).toBe(false);
    expect(matchesShortcut(event(key, { code, altKey: true, shiftKey: true, ctrlKey: true }), id, 'other')).toBe(false);
    expect(matchesShortcut(event(key, { code, altKey: true, shiftKey: true, metaKey: true }), id, 'other')).toBe(false);
    expect(shortcutLabel(id, 'other')).toBe(`Alt+Shift+${key}`);
    expect(shortcutAria(id, 'other')).toBe(`Alt+Shift+${key}`);
  });
  it('uses physical positions rather than layout letters for macOS Option navigation', () => {
    expect(matchesShortcut(event('O', { code: 'KeyS', altKey: true, shiftKey: true }), 'sheet', 'mac')).toBe(true);
    expect(matchesShortcut(event('S', { code: 'Semicolon', altKey: true, shiftKey: true }), 'sheet', 'mac')).toBe(false);
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
