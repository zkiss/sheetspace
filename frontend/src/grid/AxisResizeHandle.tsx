import type { AxisSizeWrite } from '@workbook/core/model';
import type { useAxisResize } from './useAxisResize';

export function AxisResizeHandle({ axis, id, label, size, resize }: {
  axis: AxisSizeWrite['axis']; id: string; label: string; size: number; resize: ReturnType<typeof useAxisResize>;
}) {
  return <div aria-label={`Resize ${axis} ${label}`} aria-orientation={axis === 'row' ? 'horizontal' : 'vertical'}
    className={`sheet-grid-resize-handle sheet-grid-resize-handle-${axis}`} role="separator"
    onPointerDown={(event) => resize.start(event, axis, id, size)} onPointerMove={resize.move}
    onPointerUp={resize.stop} onPointerCancel={resize.interrupt} onLostPointerCapture={resize.interrupt} />;
}
