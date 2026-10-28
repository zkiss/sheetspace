import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BodyPortal } from '@shared/ui/BodyPortal';

export function FormulaEditorPopover({ anchor, children, className }: {
  anchor: () => { left: number; top: number; bottom: number } | undefined;
  children: ReactNode;
  className: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    const place = () => {
      const target = anchor();
      if (!target || !element.current) return;
      const { width, height } = element.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(target.left, window.innerWidth - width - 8));
      const top = target.bottom + height + 8 <= window.innerHeight
        ? target.bottom + 4 : Math.max(8, target.top - height - 4);
      setPosition((current) => current.ready && current.left === left && current.top === top
        ? current : { left, top, ready: true });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (element.current) observer?.observe(element.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);
  return <BodyPortal><div className={`formula-editor-popover ${className}`} data-workspace-navigation
    ref={element} style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>
    {children}
  </div></BodyPortal>;
}
