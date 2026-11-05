import { vi } from 'vitest';

export function controlledAxisAnimations() {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  const effects: { element: Element; frames: Keyframe[]; cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element, frames: Keyframe[]) {
    const effect = { element: this, frames, cancel: vi.fn(), onfinish: null };
    effects.push(effect);
    return effect;
  } });
  return { effects, restore: () => {
    if (descriptor) Object.defineProperty(Element.prototype, 'animate', descriptor);
    else delete (Element.prototype as Partial<Element>).animate;
  } };
}
