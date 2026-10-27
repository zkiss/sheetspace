import { useState } from 'react';

export type CommandNumberField = { label: string; value: number; min?: number; max?: number; integer?: boolean };

export function CommandNumberForm({ fields, onApply }: { fields: readonly CommandNumberField[]; onApply: (values: number[]) => string | undefined }) {
  const [values, setValues] = useState(() => fields.map((field) => String(field.value)));
  const [error, setError] = useState('');
  return <form className="command-number-form" noValidate onSubmit={(event) => {
    event.preventDefault();
    const numbers = values.map(Number);
    const invalid = fields.findIndex((field, index) => !values[index]?.trim() || !Number.isFinite(numbers[index])
      || (field.integer && !Number.isInteger(numbers[index]))
      || (field.min !== undefined && numbers[index]! < field.min) || (field.max !== undefined && numbers[index]! > field.max));
    if (invalid >= 0) {
      const field = fields[invalid]!;
      setError(`Enter a valid ${field.integer ? 'whole number' : 'number'} for ${field.label}${field.min !== undefined ? `, at least ${field.min}` : ''}${field.max !== undefined ? `, at most ${field.max}` : ''}.`);
      return;
    }
    setError(onApply(numbers) ?? '');
  }}>
    {fields.map((field, index) => <label key={field.label}>{field.label}<input autoFocus={index === 0} type="number" step={field.integer ? 1 : 'any'} min={field.min} max={field.max} value={values[index]} onChange={(event) => { setValues(values.map((value, target) => target === index ? event.target.value : value)); setError(''); }} /></label>)}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button type="submit">Apply</button>
  </form>;
}
