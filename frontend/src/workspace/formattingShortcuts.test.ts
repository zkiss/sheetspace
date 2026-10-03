import { describe, expect, it } from 'vitest';
import { formattingShortcut } from './formattingActions';

const event = { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
const cases = [
  { key: 'b', shiftKey: false, action: { type: 'bold' } },
  { key: 'e', shiftKey: true, action: { type: 'alignment', value: 'center' } },
  { key: 'l', shiftKey: true, action: { type: 'alignment', value: 'left' } },
  { key: 'r', shiftKey: true, action: { type: 'alignment', value: 'right' } },
  { key: '0', shiftKey: true, action: { type: 'numberFormat', kind: 'general' } },
  { key: '1', shiftKey: true, action: { type: 'numberFormat', kind: 'number' } },
  { key: '5', shiftKey: true, action: { type: 'numberFormat', kind: 'percent' } },
] as const;

describe('formatting shortcut decoding', () => {
  it.each(cases)('decodes $key with Ctrl or Meta and rejects wrong modifiers', ({ key, shiftKey, action }) => {
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
      expect(formattingShortcut({ ...event, ...modifiers, key, shiftKey })).toEqual(action);
      expect(formattingShortcut({ ...event, ...modifiers, key: key.toUpperCase(), shiftKey })).toEqual(action);
      expect(formattingShortcut({ ...event, ...modifiers, key, shiftKey, altKey: true })).toBeUndefined();
      expect(formattingShortcut({ ...event, ...modifiers, key, shiftKey: !shiftKey })).toBeUndefined();
    }
    expect(formattingShortcut({ ...event, key, shiftKey })).toBeUndefined();
  });

  it.each([[')', 'Digit0', 'general'], ['!', 'Digit1', 'number'], ['%', 'Digit5', 'percent']])('decodes shifted %s by physical %s', (key, code, kind) => {
    expect(formattingShortcut({ ...event, key, code, ctrlKey: true, shiftKey: true })).toEqual({ type: 'numberFormat', kind });
    expect(formattingShortcut({ ...event, key, code, ctrlKey: true })).toBeUndefined();
    expect(formattingShortcut({ ...event, key, code: 'Digit2', ctrlKey: true, shiftKey: true })).toBeUndefined();
  });

  it.each(['n', 'Escape', 'ArrowLeft', '2', 'F1'])('leaves unsupported %s to its existing owner', (key) => {
    for (const shiftKey of [true, false]) expect(formattingShortcut({ ...event, key, ctrlKey: true, shiftKey })).toBeUndefined();
  });
});
