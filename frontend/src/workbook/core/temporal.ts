export type TemporalKind = 'date' | 'datetime';
export type TemporalValue = { kind: TemporalKind; value: string };

export function parseTemporalValue(input: string, kind: TemporalKind): TemporalValue | undefined {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/.exec(input);
  if (!match || (kind === 'date' ? match[4] !== undefined : match[4] === undefined)) return undefined;
  const [, y, m, d, hour, minute, second, fraction] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return undefined;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || (second !== undefined && Number(second) > 59))) return undefined;
  const date = `${y}-${m}-${d}`;
  return { kind, value: hour === undefined ? date : `${date} ${hour}:${minute}${second === undefined ? '' : `:${second}${fraction === undefined ? '' : `.${fraction}`}`}` };
}

export function encodeTemporalValue(value: TemporalValue): string {
  return `@${value.kind}:${value.value}`;
}

export function decodeTemporalValue(raw: string): TemporalValue | undefined {
  const match = /^@(date|datetime):(.+)$/.exec(raw);
  if (!match) return undefined;
  const value = parseTemporalValue(match[2]!, match[1] as TemporalKind);
  return value && encodeTemporalValue(value) === raw ? value : undefined;
}

export function compareTemporalValues(a: string, b: string): -1 | 0 | 1 {
  const key = (value: string) => {
    const [date, time = '00:00'] = value.split(' ');
    const [clock, fraction = ''] = time!.split('.');
    return `${date} ${clock!.length === 5 ? `${clock}:00` : clock}.${fraction.padEnd(9, '0')}`;
  };
  const left = key(a), right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
