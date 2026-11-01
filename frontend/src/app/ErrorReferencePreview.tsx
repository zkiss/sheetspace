import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextualReferenceLinks } from '@reference-navigation/ContextualReferenceLinks';
import type { ProjectedReferenceGeometry } from '@reference-navigation/contextualReferenceProjection';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import { errorReferenceColor, type ErrorReferenceHover } from './errorCellText';

export function ErrorReferencePreview({ hover, geometry, surface, onNavigate }: {
  hover: ErrorReferenceHover;
  geometry: ProjectedReferenceGeometry;
  surface: HTMLElement | null;
  onNavigate: (reference: FormulaInspectionReference) => void;
}) {
  const [source, setSource] = useState<ProjectedReferenceGeometry>({ kind: 'unavailable', reason: 'unmounted' });
  useEffect(() => {
    if (!hover || !surface) return;
    let frame = 0;
    const update = () => {
      const cell = hover.element.getBoundingClientRect();
      const bounds = surface.getBoundingClientRect();
      const rect = { left: cell.left - bounds.left, top: cell.top - bounds.top, right: cell.right - bounds.left, bottom: cell.bottom - bounds.top };
      setSource((previous) => previous.kind === 'visible' && Object.entries(rect).every(([key, value]) => previous.rect[key as keyof typeof rect] === value) ? previous : { kind: 'visible', rect });
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [hover, surface]);
  if (!hover || !surface) return null;
  const bounds = surface.getBoundingClientRect();
  const reference = hover.reference;
  const color = errorReferenceColor(reference);
  return createPortal(<div style={{ position: 'fixed', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, zIndex: 1002, pointerEvents: 'none' }}>
    <ContextualReferenceLinks references={[{ contextual: { reference, color }, geometry }]} source={source} visible editorActive onNavigate={onNavigate} surfaceSize={bounds} />
  </div>, document.body);
}
