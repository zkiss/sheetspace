import { useLayoutEffect, type RefObject } from 'react';

export function useOwnedScroll(container: RefObject<HTMLElement>, position?: { left: number; top: number }) {
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !position) return;
    const restore = () => {
      if (element.scrollLeft !== position.left) element.scrollLeft = position.left;
      if (element.scrollTop !== position.top) element.scrollTop = position.top;
    };
    const preventScroll = (event: Event) => event.preventDefault();
    restore();
    element.addEventListener('scroll', restore);
    element.addEventListener('wheel', preventScroll, { passive: false });
    element.addEventListener('touchmove', preventScroll, { passive: false });
    return () => {
      element.removeEventListener('scroll', restore);
      element.removeEventListener('wheel', preventScroll);
      element.removeEventListener('touchmove', preventScroll);
    };
  }, [container, position]);
}
