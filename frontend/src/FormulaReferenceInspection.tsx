import type { FormulaInspection } from './formulaInspection';

export function FormulaReferenceInspection({
  inspection,
}: {
  inspection: FormulaInspection | undefined;
}) {
  if (!inspection) {
    return null;
  }

  return (
    <section aria-label="Selected formula" className="formula-reference-inspection">
      <span className="formula-reference-inspection-label">Formula</span>
      <code>
        {inspection.parts.map((part, index) =>
          part.kind === 'text' ? (
            part.text
          ) : (
            <span
              aria-label={`${part.text}, ${part.broken ? 'broken reference' : 'reference'}`}
              className={`formula-reference-token${part.broken ? ' formula-reference-token-broken' : ''}`}
              data-broken-reference={part.broken ? 'true' : undefined}
              data-navigable={part.navigable ? 'true' : 'false'}
              data-reference-kind={part.target.kind}
              data-sheet-id={part.target.sheetId}
              key={`${part.sourceSpan.start}-${part.sourceSpan.end}-${index}`}
            >
              {part.text}
            </span>
          ),
        )}
      </code>
    </section>
  );
}
