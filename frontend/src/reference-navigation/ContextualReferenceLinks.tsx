import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { FormulaInspectionReference } from './formulaInspection';
import type { ContextualReference, ProjectedReferenceGeometry } from './contextualReferenceProjection';
import { referenceLineEndpoints } from './referenceLinkGeometry';
import '@reference-navigation/ContextualReferenceLinks.css';

export function ContextualReferenceLinks({
  references,
  source,
  visible,
  hoveredSourceSpan,
  pulseSourceSpan,
  editorActive = false,
  surfaceSize,
  onNavigate,
}: {
  references: readonly { contextual: ContextualReference; geometry: ProjectedReferenceGeometry }[];
  source: ProjectedReferenceGeometry;
  visible: boolean;
  hoveredSourceSpan?: { start: number; end: number } | null;
  pulseSourceSpan?: { start: number; end: number } | null;
  editorActive?: boolean;
  surfaceSize?: { width: number; height: number };
  onNavigate: (reference: FormulaInspectionReference) => void;
  onToggle?: () => void;
}) {
  const canvas = useRef<SVGSVGElement>(null);
  useEffect(() => {
    function updateProximity(event: PointerEvent) {
      if (editorActive) return;
      const svg = canvas.current;
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) return;
      for (const line of svg.querySelectorAll<SVGLineElement>('.contextual-reference-visible-line')) {
        const start = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(matrix);
        const end = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(matrix);
        const dx = end.x - start.x; const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const position = lengthSquared ? Math.max(0, Math.min(1, ((event.clientX - start.x) * dx + (event.clientY - start.y) * dy) / lengthSquared)) : 0;
        const distance = Math.hypot(event.clientX - start.x - position * dx, event.clientY - start.y - position * dy);
        const proximity = Math.max(0, 1 - distance / 32);
        line.style.strokeWidth = `${2 + 4 * proximity}px`;
        line.style.strokeOpacity = `${0.5 + 0.5 * proximity}`;
        const pulse = line.nextElementSibling as SVGLineElement | null;
        if (pulse?.classList.contains('contextual-reference-pulse')) {
          pulse.style.strokeWidth = `${1 + 3 * proximity}px`;
          pulse.style.setProperty('--pulse-strength', String(proximity));
          pulse.classList.toggle('contextual-reference-pulse-active', proximity > 0);
        }
      }
    }
    function clearProximity() {
      canvas.current?.querySelectorAll<SVGLineElement>('.contextual-reference-visible-line').forEach((line) => {
        line.style.removeProperty('stroke-width'); line.style.removeProperty('stroke-opacity');
        const pulse = line.nextElementSibling as SVGLineElement | null;
        if (pulse?.classList.contains('contextual-reference-pulse')) {
          pulse.style.removeProperty('stroke-width'); pulse.style.removeProperty('--pulse-strength');
          pulse.classList.remove('contextual-reference-pulse-active');
        }
      });
    }
    window.addEventListener('pointermove', updateProximity);
    window.addEventListener('blur', clearProximity);
    return () => { window.removeEventListener('pointermove', updateProximity); window.removeEventListener('blur', clearProximity); clearProximity(); };
  }, [editorActive]);
  function navigateVisibleLink(event: KeyboardEvent<SVGLineElement>, reference: FormulaInspectionReference) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigate(reference);
  }

  const activeReferences = references.filter(({ contextual }) => visible || (
    contextual.reference.sourceSpan.start === hoveredSourceSpan?.start
    && contextual.reference.sourceSpan.end === hoveredSourceSpan?.end
  ));
  return (visible || hoveredSourceSpan) && (source.kind === 'visible' || source.kind === 'overview') ? <svg aria-label="Formula reference paths" className="contextual-reference-canvas" data-workspace-native-content ref={canvas}>
      {activeReferences.flatMap(({ contextual, geometry }, index) => {
        if (geometry.kind === 'unavailable') return [];
        const sourceCenter = { x: (source.rect.left + source.rect.right) / 2, y: (source.rect.top + source.rect.bottom) / 2 };
        const { source: sourcePoint, target: targetPoint } = referenceLineEndpoints(source.rect, geometry.kind !== 'offscreen'
          ? geometry.rect
          : pointerAtSurfaceEdge(sourceCenter, geometry.target, surfaceSize));
        return [
          <line aria-hidden="true" className={`contextual-reference-visible-line${contextual.reference.sourceSpan.start === pulseSourceSpan?.start && contextual.reference.sourceSpan.end === pulseSourceSpan?.end ? ' contextual-reference-line-editor' : ''}`} key={`line-${index}`} stroke={contextual.color} x1={sourcePoint.x} x2={targetPoint.x} y1={sourcePoint.y} y2={targetPoint.y} />,
          <line aria-hidden="true" className={`contextual-reference-pulse${contextual.reference.sourceSpan.start === pulseSourceSpan?.start && contextual.reference.sourceSpan.end === pulseSourceSpan?.end ? ' contextual-reference-pulse-editor' : ''}`} key={`pulse-${index}`} pathLength={100} stroke={contextual.color} x1={sourcePoint.x} x2={targetPoint.x} y1={sourcePoint.y} y2={targetPoint.y} />,
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
