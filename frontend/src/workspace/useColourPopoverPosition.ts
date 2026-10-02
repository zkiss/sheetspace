import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Keep an open palette within the viewport without clipping its toolbar ancestors. */
export function useColourPopoverPosition(rootRef: RefObject<HTMLDivElement>, open: boolean) {
  const popoverRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!open || !root || !popover) return;
    const position = () => {
      const left = root.getBoundingClientRect().left;
      const width = popover.getBoundingClientRect().width;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const gutter = Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16') * 0.75;
      const clampedLeft = Math.max(gutter, Math.min(left, viewportWidth - width - gutter));
      popover.style.setProperty('--colour-popover-offset', `${clampedLeft - left}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(root);
    observer.observe(popover);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, rootRef]);
  return popoverRef;
}
