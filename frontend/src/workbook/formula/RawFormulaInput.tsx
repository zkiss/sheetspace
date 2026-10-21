import { forwardRef, type TextareaHTMLAttributes } from 'react';

/** Controlled raw-text boundary shared by cell and model formula editing. */
export const RawFormulaInput = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
}>(({ value, onValueChange, ...props }, ref) =>
  <textarea {...props} onChange={(event) => onValueChange(event.target.value)} ref={ref} value={value} />,
);
