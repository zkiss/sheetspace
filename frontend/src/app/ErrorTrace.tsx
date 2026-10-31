import { useState } from 'react';
import type { WorkbookError } from './workbookErrors';

export function ErrorTrace({ error, onNavigate }: {
  error: WorkbookError;
  onNavigate: (target: { sheetId: string; cell: WorkbookError['cell'] }) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const lines = error.trace ?? [];
  const selectionKey = (line: (typeof lines)[number]) => JSON.stringify([line.key, line.message, line.target?.sheetId, line.target?.cell]);
  const selected = lines.find((line) => selectionKey(line) === selectedKey) ?? lines[0];
  const activate = (line: typeof selected) => { if (line?.target) onNavigate(line.target); };
  return <section aria-label="Error trace">
    <p>{error.code} — Could not calculate <button type="button" onClick={() => onNavigate(error)}>{error.reference}</button></p>
    <div role="listbox" aria-label="Error causes" tabIndex={0} aria-activedescendant={selected ? `trace-${selected.key}` : undefined} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        const index = lines.indexOf(selected);
        const next = lines[Math.max(0, Math.min(lines.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setSelectedKey(selectionKey(next));
      } else if (event.key === 'Enter' || event.key === 'F4') {
        event.preventDefault(); event.stopPropagation(); activate(selected);
      }
    }}>
      {lines.map((line) => <div id={`trace-${line.key}`} role="option" aria-selected={line.key === selected?.key} key={line.key} onClick={() => setSelectedKey(selectionKey(line))} style={{ paddingLeft: `${line.depth}em` }}>
        caused by {line.target ? <button type="button" onClick={() => activate(line)}>{line.target.reference}</button> : 'unresolved origin'}: {line.message}
      </div>)}
    </div>
  </section>;
}
