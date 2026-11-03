import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOwnedScroll } from './useOwnedScroll';

describe('owned scroll', () => {
  it('restores the captured position and blocks scrolling until ownership ends', () => {
    const element = document.createElement('div');
    const ref = { current: element };
    const position = { left: 45, top: 92 };
    const { rerender, unmount } = renderHook(({ owned }) => useOwnedScroll(ref, owned), { initialProps: { owned: position as typeof position | undefined } });
    expect([element.scrollLeft, element.scrollTop]).toEqual([45, 92]);
    element.scrollTop = 120;
    element.dispatchEvent(new Event('scroll'));
    expect(element.scrollTop).toBe(92);
    const wheel = new WheelEvent('wheel', { cancelable: true });
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    rerender({ owned: undefined });
    element.scrollTop = 120;
    element.dispatchEvent(new Event('scroll'));
    expect(element.scrollTop).toBe(120);
    unmount();
  });
});
