import { parseTemporalValue, type TemporalKind } from '@workbook/core/temporal';

export function temporalPickerProjection(raw: string, kind: TemporalKind): { value: string; exactText: boolean } {
  if (!raw) return { value: '', exactText: false };
  const parsed = parseTemporalValue(raw, kind);
  if (!parsed) return { value: '', exactText: true };
  if (kind === 'datetime' && parsed.value.length > 16) return { value: '', exactText: true };
  return { value: parsed.value.replace(' ', 'T'), exactText: false };
}

export function temporalPickerChange(value: string, kind: TemporalKind): string | undefined {
  if (!value) return '';
  return parseTemporalValue(value, kind)?.value;
}
