import { useEffect, useRef, useState, type ReactNode } from 'react';
import './NavigationPalette.css';

export type NavigationCommand = {
  id: string;
  label: string;
  /** Groups make query results readable without moving resolution into the UI. */
  group?: string;
  shortcut?: string;
  unavailable?: string;
  run: () => void;
};

/** A small, keyboard-owned command surface. Command resolution remains in Workspace. */
export function NavigationPalette({ commands, onClose, rowPicker, panel }: {
  commands: readonly NavigationCommand[];
  onClose: () => void;
  rowPicker?: { sheetName: string; rowCount: number; onNavigate: (row: number) => void };
  panel?: { title: string; content: ReactNode };
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [rowError, setRowError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTitle = panel?.title;
  const matches = commands.filter((command) => command.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const matchAvailability = matches.map((command) => command.unavailable ? '0' : '1').join('');
  const activeId = matches[index] ? `navigation-command-${matches[index]!.id}` : undefined;
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (panelTitle) panelRef.current?.querySelector<HTMLElement>('input, select, button:not(:disabled)')?.focus(); }, [panelTitle]);
  useEffect(() => {
    setIndex((current) => matchAvailability[current] === '1'
      ? current : Math.max(0, matchAvailability.indexOf('1')));
  }, [matchAvailability, query]);
  useEffect(() => {
    const container = list.current;
    const active = container?.children[index];
    if (!container || !active) return;
    const parent = container.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.top < parent.top) container.scrollTop -= parent.top - item.top;
    else if (item.bottom > parent.bottom) container.scrollTop += item.bottom - parent.bottom;
  }, [index]);
  function moveSelection(direction: 1 | -1) {
    setIndex((current) => {
      for (let next = current + direction; next >= 0 && next < matches.length; next += direction) {
        if (!matches[next]!.unavailable) return next;
      }
      return current;
    });
  }
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (panel && event.key !== 'Tab') return;
    if (rowPicker) {
      if (event.key === 'Enter' && event.target === input.current) {
        event.preventDefault();
        const number = Number(query);
        if (!/^[1-9][0-9]*$/.test(query) || !Number.isSafeInteger(number) || number > rowPicker.rowCount) {
          setRowError(`Enter a row number from 1 to ${rowPicker.rowCount}.`);
          return;
        }
        rowPicker.onNavigate(number);
        return;
      }
      if (event.key !== 'Tab') return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1); return; }
    if (event.key === 'Enter' && event.target === input.current) {
      const command = matches[index];
      if (command && !command.unavailable) { event.preventDefault(); command.run(); }
    }
    if (event.key === 'Tab') {
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current >= focusable.length - 1 ? 0 : current + 1);
      event.preventDefault();
      focusable[next]?.focus();
    }
  }
  return <div className="dialog-backdrop navigation-palette-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label="Command palette" aria-modal="true" className="navigation-palette" data-workspace-navigation onKeyDown={keyDown} role="dialog">
      <div className="navigation-palette-search">
        {panel ? <strong>{panel.title}</strong> : <><span aria-hidden="true" className="navigation-palette-search-icon">⌕</span>
        <label className="navigation-palette-search-label" htmlFor="navigation-command-search">{rowPicker ? 'Row number' : 'Command search'}</label>
        <input aria-activedescendant={rowPicker ? undefined : activeId} aria-controls={rowPicker ? undefined : 'navigation-command-results'} aria-expanded={rowPicker ? undefined : 'true'} aria-haspopup={rowPicker ? undefined : 'listbox'} aria-invalid={rowError ? 'true' : undefined} aria-describedby={rowPicker ? 'navigation-row-hint' : undefined} id="navigation-command-search" inputMode={rowPicker ? 'numeric' : undefined} onChange={(event) => { setQuery(event.target.value); setIndex(0); setRowError(''); }} placeholder={rowPicker ? 'Enter a row number…' : 'Type a command or search…'} ref={input} role={rowPicker ? undefined : 'combobox'} value={query} /></>}
        <button aria-label="Close command palette" className="navigation-palette-close" onClick={onClose} title="Close (Esc)" type="button">Esc</button>
      </div>
      {panel ? <div className="navigation-palette-panel" ref={panelRef}>{panel.content}</div> : rowPicker ? <div className="navigation-row-picker" id="navigation-row-hint">
        <span>Go to a row in <strong>{rowPicker.sheetName}</strong></span>
        <span>Rows 1–{rowPicker.rowCount}</span>
        {rowError ? <span className="navigation-row-error" role="alert">{rowError}</span> : null}
      </div> : <ul aria-label="Command results" className="navigation-palette-results" id="navigation-command-results" ref={list} role="listbox">
        {matches.map((command, commandIndex) => <li aria-selected={commandIndex === index && !command.unavailable} className="navigation-palette-item" id={`navigation-command-${command.id}`} key={command.id} role="option">
          {command.group && (commandIndex === 0 || matches[commandIndex - 1]?.group !== command.group) ? <strong className="navigation-command-group">{command.group}</strong> : null}
          <button className="navigation-command" disabled={Boolean(command.unavailable)} onClick={command.run} onMouseEnter={() => { if (!command.unavailable) setIndex(commandIndex); }} type="button">
            <span className="navigation-command-text"><span className="navigation-command-label">{command.label}</span>
              {command.unavailable ? <small className="navigation-command-reason">{command.unavailable}</small> : null}</span>
            {command.shortcut ? <kbd className="navigation-command-shortcut">{command.shortcut}</kbd> : null}
          </button>
        </li>)}
      </ul>}
      {!panel && !rowPicker && matches.length === 0 ? <p className="navigation-palette-empty" role="status">No commands found.</p> : null}
      <div className="navigation-palette-footer">{!panel && !rowPicker ? <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span> : null}{!panel ? <span><kbd>↵</kbd> {rowPicker ? 'go to row' : 'select'}</span> : null}<span><kbd>Esc</kbd> close</span></div>
    </section>
  </div>;
}
