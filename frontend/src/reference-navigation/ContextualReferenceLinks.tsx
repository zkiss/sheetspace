import { type KeyboardEvent } from 'react';
import type { FormulaInspectionReference } from './formulaInspection';
import type { ContextualReference, ProjectedReferenceGeometry } from './contextualReferenceProjection';
import '@reference-navigation/ContextualReferenceLinks.css';

export function ContextualReferenceLinks({
  references,
  source,
  visible,
  hoveredSourceSpan,
  onNavigate,
}: {
  references: readonly { contextual: ContextualReference; geometry: ProjectedReferenceGeometry }[];
  source: ProjectedReferenceGeometry;
  visible: boolean;
  hoveredSourceSpan?: { start: number; end: number } | null;
  onNavigate: (reference: FormulaInspectionReference) => void;
  onToggle?: () => void;
}) {
  function navigateVisibleLink(event: KeyboardEvent<SVGLineElement>, reference: FormulaInspectionReference) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigate(reference);
  }

  const activeReferences = references.filter(({ contextual }) => visible || (
    contextual.reference.sourceSpan.start === hoveredSourceSpan?.start
    && contextual.reference.sourceSpan.end === hoveredSourceSpan?.end
  ));
  return (visible || hoveredSourceSpan) && source.kind === 'visible' ? <svg aria-label="Formula reference paths" className="contextual-reference-canvas" data-workspace-native-content>
      {activeReferences.flatMap(({ contextual, geometry }, index) => geometry.kind === 'visible' ? [
        <line aria-hidden="true" key={`line-${index}`} stroke={contextual.color} x1={(source.rect.left + source.rect.right) / 2} x2={(geometry.rect.left + geometry.rect.right) / 2} y1={(source.rect.top + source.rect.bottom) / 2} y2={(geometry.rect.top + geometry.rect.bottom) / 2} />,
        <line aria-label={`Navigate to ${contextual.reference.text}`} className="contextual-reference-link-hit-target" key={`hit-target-${index}`} onClick={() => onNavigate(contextual.reference)} onKeyDown={(event) => navigateVisibleLink(event, contextual.reference)} role="button" stroke="transparent" strokeWidth="12" tabIndex={0} x1={(source.rect.left + source.rect.right) / 2} x2={(geometry.rect.left + geometry.rect.right) / 2} y1={(source.rect.top + source.rect.bottom) / 2} y2={(geometry.rect.top + geometry.rect.bottom) / 2} />,
        <rect key={`target-${index}`} height={geometry.rect.bottom - geometry.rect.top} stroke={contextual.color} width={geometry.rect.right - geometry.rect.left} x={geometry.rect.left} y={geometry.rect.top} />,
      ] : [])}
    </svg> : null;
}
