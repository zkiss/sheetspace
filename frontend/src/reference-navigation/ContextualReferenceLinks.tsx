import { type KeyboardEvent } from 'react';
import type { FormulaInspectionReference } from './formulaInspection';
import type { ContextualReference, ProjectedReferenceGeometry } from './contextualReferenceProjection';
import { referenceLineEndpoints } from './referenceLinkGeometry';
import '@reference-navigation/ContextualReferenceLinks.css';

export function ContextualReferenceLinks({
  references,
  source,
  visible,
  hoveredSourceSpan,
  surfaceSize,
  onNavigate,
}: {
  references: readonly { contextual: ContextualReference; geometry: ProjectedReferenceGeometry }[];
  source: ProjectedReferenceGeometry;
  visible: boolean;
  hoveredSourceSpan?: { start: number; end: number } | null;
  surfaceSize?: { width: number; height: number };
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
  return (visible || hoveredSourceSpan) && (source.kind === 'visible' || source.kind === 'overview') ? <svg aria-label="Formula reference paths" className="contextual-reference-canvas" data-workspace-native-content>
      {activeReferences.flatMap(({ contextual, geometry }, index) => {
        if (geometry.kind === 'unavailable') return [];
        const sourceCenter = { x: (source.rect.left + source.rect.right) / 2, y: (source.rect.top + source.rect.bottom) / 2 };
        const { source: sourcePoint, target: targetPoint } = referenceLineEndpoints(source.rect, geometry.kind !== 'offscreen'
          ? geometry.rect
          : pointerAtSurfaceEdge(sourceCenter, geometry.target, surfaceSize));
        return [
          <line aria-hidden="true" key={`line-${index}`} stroke={contextual.color} x1={sourcePoint.x} x2={targetPoint.x} y1={sourcePoint.y} y2={targetPoint.y} />,
          <line aria-label={`Navigate to ${contextual.reference.text}`} className="contextual-reference-link-hit-target" key={`hit-target-${index}`} onClick={() => onNavigate(contextual.reference)} onKeyDown={(event) => navigateVisibleLink(event, contextual.reference)} role="button" stroke="transparent" strokeWidth="12" tabIndex={0} x1={sourcePoint.x} x2={targetPoint.x} y1={sourcePoint.y} y2={targetPoint.y} />,
          geometry.kind !== 'offscreen'
            ? <rect className={geometry.kind === 'overview' ? 'contextual-reference-overview-target' : undefined} key={`target-${index}`} height={geometry.rect.bottom - geometry.rect.top} stroke={contextual.color} width={geometry.rect.right - geometry.rect.left} x={geometry.rect.left} y={geometry.rect.top} />
            : <circle aria-hidden="true" className="contextual-reference-offscreen-marker" cx={targetPoint.x} cy={targetPoint.y} fill={contextual.color} key={`marker-${index}`} r="5" />,
        ];
      })}
    </svg> : null;
}

function pointerAtSurfaceEdge(source: { x: number; y: number }, target: { x: number; y: number }, surfaceSize = { width: window.innerWidth, height: window.innerHeight }) {
  const inset = 12;
  const width = surfaceSize.width;
  const height = surfaceSize.height;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const factor = Math.min(
    dx > 0 ? (width - inset - source.x) / dx : dx < 0 ? (inset - source.x) / dx : Number.POSITIVE_INFINITY,
    dy > 0 ? (height - inset - source.y) / dy : dy < 0 ? (inset - source.y) / dy : Number.POSITIVE_INFINITY,
  );
  return { x: source.x + dx * factor, y: source.y + dy * factor };
}
