import { describe, expect, it } from 'vitest';
import { appendNavigationContext, EMPTY_NAVIGATION_HISTORY, traverseNavigationHistory, type NavigationContext } from './navigationHistory';

const place = (x: number): NavigationContext => ({ viewport: { x, y: 0, scale: 1 }, selection: null, scroll: {} });

describe('navigation history', () => {
  it('coalesces adjacent places and inserts a branch before retained Forward places', () => {
    let history = EMPTY_NAVIGATION_HISTORY;
    history = appendNavigationContext(history, place(1));
    history = appendNavigationContext(history, place(2));
    history = appendNavigationContext(history, place(3));
    history = traverseNavigationHistory(history, 'back')!.history;
    history = appendNavigationContext(history, place(4));
    expect(history.entries.map((entry) => entry.viewport.x)).toEqual([1, 2, 4, 3]);
    expect(history.cursor).toBe(2);
    expect(traverseNavigationHistory(history, 'forward')!.context.viewport.x).toBe(3);
    expect(appendNavigationContext(history, place(4))).toBe(history);
  });

  it('does not traverse beyond either end', () => {
    const history = appendNavigationContext(EMPTY_NAVIGATION_HISTORY, place(1));
    expect(traverseNavigationHistory(history, 'back')).toBeUndefined();
    expect(traverseNavigationHistory(history, 'forward')).toBeUndefined();
  });
});
