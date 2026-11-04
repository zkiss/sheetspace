export type Platform = 'mac' | 'other';
export type Shortcut = {
  key: string;
  code?: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
};
export type Binding = readonly Shortcut[] | { mac: readonly Shortcut[]; other: readonly Shortcut[] };
export type Keymap = Readonly<Record<string, Binding>>;
export type KeyboardInput = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

type PlatformSource = { userAgentData?: { platform?: string }; platform?: string };

export function detectPlatform(source: PlatformSource | undefined = typeof navigator === 'undefined' ? undefined : navigator): Platform {
  return /mac|iphone|ipad|ipod/i.test(source?.userAgentData?.platform || source?.platform || '') ? 'mac' : 'other';
}

// This is the sole declaration of application shortcut chords. IDs may also name
// context-specific actions; the owning UI decides which commands are available.
export const keymap = {
  'new-sheet': [{ key: 'n', shift: true }],
  back: [{ key: 'ArrowLeft', alt: true }], forward: [{ key: 'ArrowRight', alt: true }],
  undo: [{ key: 'z', mod: true }],
  redo: { mac: [{ key: 'z', mod: true, shift: true }], other: [{ key: 'y', mod: true }, { key: 'z', mod: true, shift: true }] },
  'command-palette': [{ key: 'p', mod: true, shift: true }],
  sheet: [{ key: 's', code: 'KeyS', alt: true, shift: true }], column: [{ key: 'c', code: 'KeyC', alt: true, shift: true }],
  row: [{ key: 'r', code: 'KeyR', alt: true, shift: true }], definition: [{ key: 'd', code: 'KeyD', alt: true, shift: true }],
  errors: [{ key: 'e', code: 'KeyE', alt: true, shift: true }], usages: [{ key: 'u', code: 'KeyU', alt: true, shift: true }],
  reference: [{ key: 'Enter', alt: true }],
  copy: [], cut: [], paste: [],
  bold: [{ key: 'b', mod: true }],
  'align-center': [{ key: 'e', mod: true, shift: true }],
  'align-left': [{ key: 'l', mod: true, shift: true }],
  'align-right': [{ key: 'r', mod: true, shift: true }],
  'format-general': [{ key: '0', code: 'Digit0', mod: true, shift: true }],
  'format-number': [{ key: '1', code: 'Digit1', mod: true, shift: true }],
  'format-percent': [{ key: '5', code: 'Digit5', mod: true, shift: true }],
  'grid-left': [{ key: 'ArrowLeft' }],
  'grid-left-select': [{ key: 'ArrowLeft', shift: true }],
  'grid-left-jump': [{ key: 'ArrowLeft', mod: true }],
  'grid-left-jump-select': [{ key: 'ArrowLeft', mod: true, shift: true }],
  'grid-right': [{ key: 'ArrowRight' }],
  'grid-right-select': [{ key: 'ArrowRight', shift: true }],
  'grid-right-jump': [{ key: 'ArrowRight', mod: true }],
  'grid-right-jump-select': [{ key: 'ArrowRight', mod: true, shift: true }],
  'grid-up': [{ key: 'ArrowUp' }],
  'grid-up-select': [{ key: 'ArrowUp', shift: true }],
  'grid-up-jump': [{ key: 'ArrowUp', mod: true }],
  'grid-up-jump-select': [{ key: 'ArrowUp', mod: true, shift: true }],
  'grid-down': [{ key: 'ArrowDown' }],
  'grid-down-select': [{ key: 'ArrowDown', shift: true }],
  'grid-down-jump': [{ key: 'ArrowDown', mod: true }],
  'grid-down-jump-select': [{ key: 'ArrowDown', mod: true, shift: true }],
  'grid-home': [{ key: 'Home' }],
  'grid-home-select': [{ key: 'Home', shift: true }],
  'grid-home-jump': [{ key: 'Home', mod: true }],
  'grid-home-jump-select': [{ key: 'Home', mod: true, shift: true }],
  'grid-end': [{ key: 'End' }],
  'grid-end-select': [{ key: 'End', shift: true }],
  'grid-end-jump': [{ key: 'End', mod: true }],
  'grid-end-jump-select': [{ key: 'End', mod: true, shift: true }],
  'grid-next': [{ key: 'Tab' }],
  'grid-previous': [{ key: 'Tab', shift: true }],
  'grid-previous-row': [{ key: 'Enter', shift: true }],
  'edit-cell': [{ key: 'F2' }, { key: 'Enter' }],
  'clear-cells': [{ key: 'Delete' }, { key: 'Backspace' }],
  'entry-submit': [{ key: 'Enter' }], 'entry-edit': [{ key: 'F2' }],
  'error-inspect': [{ key: 'F2' }], 'error-follow': [{ key: 'Enter' }, { key: 'F4' }],
  'reference-navigate': [{ key: 'F4' }], 'toggle-editor-mode': [{ key: 'F2' }],
  'editor-apply': [{ key: 'Enter', mod: true }], 'editor-cancel': [{ key: 'Escape', mod: true }],
  'editor-close': [{ key: 'Escape' }],
  'editor-complete': [{ key: 'Space', code: 'Space', mod: true }],
  'editor-commit-down': [{ key: 'Enter' }], 'editor-commit-next': [{ key: 'Tab' }],
  'editor-commit-previous': [{ key: 'Tab', shift: true }],
  'completion-accept': [{ key: 'Enter' }, { key: 'Tab' }],
  'completion-next': [{ key: 'ArrowDown' }], 'completion-previous': [{ key: 'ArrowUp' }],
  'completion-dismiss': [{ key: 'Escape' }],
  'dialog-save': [{ key: 'Enter', mod: true }],
  'property-add': [{ key: 'Enter', alt: true, shift: true }],
  'property-remove': [{ key: 'Delete', alt: true, shift: true }],
  'property-move-up': [{ key: 'ArrowUp', alt: true, shift: true }],
  'property-move-down': [{ key: 'ArrowDown', alt: true, shift: true }],
  'gesture-pan': [{ key: 'Space', code: 'Space' }, { key: 'Space', code: 'Space', shift: true }],
  cancel: [{ key: 'Escape' }],
} as const satisfies Keymap;

export type ShortcutId = keyof typeof keymap;

// Browser clipboard events always retain these native chords, independently of app bindings.
const nativeClipboard: Keymap = {
  copy: [{ key: 'c', mod: true }], cut: [{ key: 'x', mod: true }], paste: [{ key: 'v', mod: true }],
};

function bindings(id: string, platform: Platform, map: Keymap): readonly Shortcut[] {
  const binding = map[id];
  const configured = !binding ? [] : 'mac' in binding ? binding[platform] : binding;
  return [...(nativeClipboard[id] as readonly Shortcut[] | undefined ?? []), ...configured];
}

export function matchesShortcut(event: KeyboardInput, id: string, platform: Platform = detectPlatform(), map: Keymap = keymap): boolean {
  return bindings(id, platform, map).some((shortcut) => {
    const primary = !!shortcut.mod;
    return event.ctrlKey === (platform === 'other' && primary)
      && event.metaKey === (platform === 'mac' && primary)
      && event.altKey === !!shortcut.alt && event.shiftKey === !!shortcut.shift
      && (shortcut.code ? event.code === shortcut.code : event.key.toLowerCase() === shortcut.key.toLowerCase());
  });
}

export function matchesNativeClipboard(event: KeyboardInput, id: string, platform: Platform = detectPlatform()): boolean {
  return id in nativeClipboard && matchesShortcut(event, id, platform, {});
}

export function shortcutLabel(id: string, platform: Platform = detectPlatform(), map: Keymap = keymap): string | undefined {
  const labels = bindings(id, platform, map).map((shortcut) => [
    shortcut.mod ? (platform === 'mac' ? '⌘' : 'Ctrl') : '',
    shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '',
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key.replace('Arrow', ''),
  ].filter(Boolean).join('+'));
  return labels.length ? labels.join(' / ') : undefined;
}


export function shortcutAria(id: string, platform: Platform = detectPlatform(), map: Keymap = keymap): string | undefined {
  const labels = bindings(id, platform, map).map((shortcut) => [
    shortcut.mod ? (platform === 'mac' ? 'Meta' : 'Control') : '',
    shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '',
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].filter(Boolean).join('+'));
  return labels.length ? labels.join(' ') : undefined;
}

export type ShortcutCommand<Context> = { id: string; unavailable?: string; run: (context: Context) => void };

export function dispatchShortcut<Context>(event: KeyboardInput, commands: readonly ShortcutCommand<Context>[], context: Context, platform: Platform = detectPlatform(), map: Keymap = keymap): boolean {
  const command = commands.find((item) => !item.unavailable && matchesShortcut(event, item.id, platform, map));
  if (!command) return false;
  command.run(context);
  return true;
}
