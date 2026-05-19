import type { FormEvent } from 'react';
import type { PendingSheetCreation, PendingSheetRename } from './appTypes';

export function SheetDialog({
  error,
  id,
  label,
  name,
  onCancel,
  onNameChange,
  onSubmit,
  submitLabel,
  title,
}: {
  error: string;
  id: string;
  label: string;
  name: string;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
}) {
  const errorId = `${id}-error`;

  return (
    <div className="dialog-backdrop" role="presentation">
      <form aria-label={label} className="sheet-dialog" onSubmit={onSubmit}>
        <h2>{title}</h2>
        <label htmlFor={id}>Sheet name</label>
        <input
          aria-describedby={error ? errorId : undefined}
          autoFocus
          id={id}
          onChange={(event) => onNameChange(event.target.value)}
          value={name}
        />
        {error ? (
          <p className="form-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function CreateSheetDialog({
  error,
  pendingCreation,
  sheetName,
  onCancel,
  onNameChange,
  onSubmit,
}: {
  error: string;
  pendingCreation: PendingSheetCreation;
  sheetName: string;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SheetDialog
      error={error}
      id="sheet-name"
      label="Create sheet"
      name={sheetName}
      onCancel={onCancel}
      onNameChange={onNameChange}
      onSubmit={onSubmit}
      submitLabel="Create"
      title={pendingCreation.label}
    />
  );
}

export function RenameSheetDialog({
  error,
  pendingRename,
  sheetName,
  onCancel,
  onNameChange,
  onSubmit,
}: {
  error: string;
  pendingRename: PendingSheetRename;
  sheetName: string;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SheetDialog
      error={error}
      id="rename-sheet-name"
      label="Rename sheet"
      name={sheetName}
      onCancel={onCancel}
      onNameChange={onNameChange}
      onSubmit={onSubmit}
      submitLabel="Save"
      title={`Rename ${pendingRename.currentName}`}
    />
  );
}
