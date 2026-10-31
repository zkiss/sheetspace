import { useEffect, useRef, useState } from 'react';
import type { WorkbookError } from './workbookErrors';

export function ErrorList({ errors, open, focusRequest, onClose, onActivate }: {
  errors: readonly WorkbookError[];
  open: boolean;
  focusRequest: number;
  onClose: () => void;
  onActivate: (error: WorkbookError) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const selected = errors.find((error) => error.key === selectedKey) ?? errors[0];
  useEffect(() => { if (open) list.current?.focus(); }, [open, focusRequest]);
  useEffect(() => { if (selected?.key !== selectedKey) setSelectedKey(selected?.key); }, [selected?.key, selectedKey]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [selected?.key, open]);
  if (!open) return null;
  return <section aria-label="Workbook errors" style={{ position: 'absolute', bottom: 0, right: 0, zIndex: 20, background: 'white', maxHeight: '40vh', overflow: 'auto', minWidth: 360 }}>
    <button type="button" onClick={onClose}>Close errors</button>
    <div ref={list} tabIndex={0} role="grid" aria-label="Error list" aria-activedescendant={selected ? `error-row-${errors.indexOf(selected)}` : undefined} onKeyDown={(event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation();
        const index = errors.indexOf(selected);
        const next = errors[Math.max(0, Math.min(errors.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setSelectedKey(next.key);
      } else if (event.key === 'Enter' || event.key === 'F4') {
        event.preventDefault(); event.stopPropagation();
        if (selected) onActivate(selected);
      }
    }}>
      {errors.length === 0 ? <p>No workbook errors.</p> : <table><thead><tr><th>Reference</th><th>Error code</th><th>Error text</th></tr></thead><tbody>
        {errors.map((error, index) => <tr id={`error-row-${index}`} key={error.key} aria-selected={error.key === selected?.key} onClick={() => { setSelectedKey(error.key); onActivate(error); }} style={{ background: error.key === selected?.key ? '#dbeafe' : undefined, cursor: 'pointer' }}><td>{error.reference}</td><td>{error.code}</td><td>{error.text}</td></tr>)}
      </tbody></table>}
    </div>
  </section>;
}
