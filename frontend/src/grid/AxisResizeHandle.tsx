import { useCallback, useRef } from 'react';
import type { AxisSizeWrite } from '@workbook/core/model';
import type { useAxisResize } from './useAxisResize';

export function AxisResizeHandle({ axis, id, label, size, resize }: {
  axis: AxisSizeWrite['axis']; id: string; label: string; size: number; resize: ReturnType<typeof useAxisResize>;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const { detachHandle } = resize;
  const registerHandle = useCallback((next: HTMLDivElement | null) => {
    if (!next && element.current) detachHandle(element.current);
    element.current = next;
  }, [detachHandle]);
  return <div aria-label={`Resize ${axis} ${label}`} aria-orientation={axis === 'row' ? 'horizontal' : 'vertical'}
    ref={registerHandle}
    className={`sheet-grid-resize-handle sheet-grid-resize-handle-${axis}`} role="separator"
    onPointerDown={(event) => resize.start(event, axis, id, size)} onPointerMove={resize.move}
    onPointerUp={resize.stop} onPointerCancel={resize.interrupt} onLostPointerCapture={resize.interrupt} />;
}
