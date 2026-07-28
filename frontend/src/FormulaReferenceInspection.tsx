import { useEffect, useState, type MouseEvent } from 'react';
import type {
  FormulaInspection,
  FormulaInspectionReference,
} from './formulaInspection';

export function FormulaReferenceInspection({
  inspection,
  onNavigate,
}: {
  inspection: FormulaInspection | undefined;
  onNavigate: (reference: FormulaInspectionReference) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const inspectionKey = inspection
    ? `${inspection.raw}:${inspection.references.map(
      (reference) => `${reference.sourceSpan.start}:${reference.target.sheetId}`,
    ).join(',')}`
    : '';

  useEffect(() => setFeedback(''), [inspectionKey]);

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
    <section aria-label="Selected formula" className="formula-reference-inspection">
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
              data-broken-reference={part.broken ? 'true' : undefined}
              data-navigable={part.navigable ? 'true' : 'false'}
              data-reference-kind={part.target.kind}
              data-sheet-id={part.target.sheetId}
              key={`${part.sourceSpan.start}-${part.sourceSpan.end}-${index}`}
              onClick={(event) => handleReferenceClick(event, part)}
              title={part.broken
                ? 'Broken reference. Target is unavailable.'
                : 'Ctrl-click or Cmd-click to navigate.'}
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
