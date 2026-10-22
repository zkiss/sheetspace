import { useEffect, useRef, useState } from 'react';

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
export function NavigationPalette({ commands, onClose }: { commands: readonly NavigationCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = commands.filter((command) => command.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setIndex((current) => Math.min(current, Math.max(0, matches.length - 1))); }, [matches.length]);
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((current) => Math.min(matches.length - 1, current + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)); }
    if (event.key === 'Enter') {
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
  return <div className="dialog-backdrop" role="presentation">
    <section aria-label="Command palette" aria-modal="true" className="data-model-dialog" data-workspace-navigation onKeyDown={keyDown} role="dialog">
      <label>Command search<input aria-controls="navigation-command-results" onChange={(event) => setQuery(event.target.value)} ref={input} value={query} /></label>
      <ul aria-label="Command results" id="navigation-command-results" role="listbox">
        {matches.map((command, commandIndex) => <li aria-selected={commandIndex === index} key={command.id} role="option">
          {command.group && (commandIndex === 0 || matches[commandIndex - 1]?.group !== command.group) ? <strong className="navigation-command-group">{command.group}</strong> : null}
          <button disabled={Boolean(command.unavailable)} onClick={command.run} type="button">
            {command.label}{command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            {command.unavailable ? <small>{command.unavailable}</small> : null}
          </button>
        </li>)}
      </ul>
      {matches.length === 0 ? <p role="status">No commands found.</p> : null}
      <button onClick={onClose} type="button">Close</button>
    </section>
  </div>;
}
