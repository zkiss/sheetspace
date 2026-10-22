import { type KeyboardEvent } from 'react';
import type { FormulaInspectionReference } from './formulaInspection';
import type { ContextualReference, ProjectedReferenceGeometry } from './contextualReferenceProjection';
import '@reference-navigation/ContextualReferenceLinks.css';

export function ContextualReferenceLinks({
  references,
  source,
  visible,
  onNavigate,
  onToggle,
}: {
  references: readonly { contextual: ContextualReference; geometry: ProjectedReferenceGeometry }[];
  source: ProjectedReferenceGeometry;
  visible: boolean;
  onNavigate: (reference: FormulaInspectionReference) => void;
  onToggle: () => void;
}) {
  function navigateVisibleLink(event: KeyboardEvent<SVGLineElement>, reference: FormulaInspectionReference) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onNavigate(reference);
  }

  return <aside aria-label="Formula reference links" className="contextual-reference-links" data-workspace-native-content>
    <button aria-pressed={visible} className="contextual-reference-toggle" onClick={onToggle} type="button">
      {visible ? 'Hide reference links' : 'Show reference links'}
    </button>
    {visible ? <div className="contextual-reference-source-list">
      {references.map(({ contextual, geometry }, index) => {
        const unavailable = geometry.kind === 'unavailable';
        return <button
          aria-label={`${contextual.reference.text}${unavailable ? `, ${geometry.reason} spatial endpoint` : ''}`}
          className="contextual-reference-source"
          data-reference-color={contextual.color}
          data-reference-status={geometry.kind === 'visible' ? 'visible' : geometry.reason}
          disabled={!contextual.reference.navigable}
          key={`${contextual.reference.sourceSpan.start}-${index}`}
          onClick={() => onNavigate(contextual.reference)}
          type="button"
        >
          <span aria-hidden="true" className="contextual-reference-swatch" style={{ backgroundColor: contextual.color }} />
          {contextual.reference.text}{unavailable ? ` (${geometry.reason})` : ''}
        </button>;
      })}
    </div> : null}
    {visible && source.kind === 'visible' ? <svg className="contextual-reference-canvas">
      {references.flatMap(({ contextual, geometry }, index) => geometry.kind === 'visible' ? [
        <line aria-hidden="true" key={`line-${index}`} stroke={contextual.color} x1={(source.rect.left + source.rect.right) / 2} x2={(geometry.rect.left + geometry.rect.right) / 2} y1={(source.rect.top + source.rect.bottom) / 2} y2={(geometry.rect.top + geometry.rect.bottom) / 2} />,
        <line aria-label={`Navigate to ${contextual.reference.text}`} className="contextual-reference-link-hit-target" key={`hit-target-${index}`} onClick={() => onNavigate(contextual.reference)} onKeyDown={(event) => navigateVisibleLink(event, contextual.reference)} role="button" stroke="transparent" strokeWidth="12" tabIndex={0} x1={(source.rect.left + source.rect.right) / 2} x2={(geometry.rect.left + geometry.rect.right) / 2} y1={(source.rect.top + source.rect.bottom) / 2} y2={(geometry.rect.top + geometry.rect.bottom) / 2} />,
        <rect key={`target-${index}`} height={geometry.rect.bottom - geometry.rect.top} stroke={contextual.color} width={geometry.rect.right - geometry.rect.left} x={geometry.rect.left} y={geometry.rect.top} />,
      ] : [])}
    </svg> : null}
  </aside>;
}
