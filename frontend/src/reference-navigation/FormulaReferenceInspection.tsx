import { useState, type MouseEvent, type CSSProperties } from 'react';
import type { FormulaInspection } from '@reference-navigation/formulaInspection';
import type { FormulaInspectionReference } from '@workbook/formula/formulaInspectionContracts';
import '@reference-navigation/FormulaReferenceInspection.css';

export function FormulaReferenceInspection({
  inspection,
  onNavigate,
  onReferenceHover,
  referenceColors,
}: {
  inspection: FormulaInspection | undefined;
  onNavigate: (reference: FormulaInspectionReference) => void;
  onReferenceHover?: (span: { start: number; end: number } | null) => void;
  referenceColors?: ReadonlyMap<number, string>;
}) {
  const [feedback, setFeedback] = useState('');

  if (!inspection) {
    return null;
  }

  function handleReferenceClick(
    event: MouseEvent<HTMLButtonElement>,
    reference: FormulaInspectionReference,
  ) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    if (!reference.navigable) {
      setFeedback(`Cannot navigate: ${reference.text} has a broken target.`);
      return;
    }

    setFeedback('');
    onNavigate(reference);
  }

  return (
    <section aria-label="Selected formula" className="formula-reference-inspection" data-workspace-native-content>
      <span className="formula-reference-inspection-label">Formula</span>
      <code>
        {inspection.parts.map((part, index) =>
          part.kind === 'text' ? (
            part.text
          ) : (
            <button
              aria-label={`${part.text}, ${part.broken ? 'broken reference' : 'reference'}`}
              aria-disabled={part.broken ? 'true' : undefined}
              className={`formula-reference-token${part.broken ? ' formula-reference-token-broken' : ''}`}
              style={{ '--formula-reference-color': referenceColors?.get(part.sourceSpan.start) } as CSSProperties}
              data-broken-reference={part.broken ? 'true' : undefined}
              data-navigable={part.navigable ? 'true' : 'false'}
              data-reference-kind={part.target.kind}
              data-sheet-id={part.target.sheetId}
              data-workspace-navigation
              key={`${part.sourceSpan.start}-${part.sourceSpan.end}-${index}`}
              onMouseEnter={() => onReferenceHover?.(part.sourceSpan)}
              onMouseLeave={() => onReferenceHover?.(null)}
              onClick={(event) => handleReferenceClick(event, part)}
              type="button"
            >
              {part.text}
            </button>
          ),
        )}
      </code>
      <span aria-live="polite" className="formula-reference-feedback" role="status">
        {feedback}
      </span>
    </section>
  );
}
