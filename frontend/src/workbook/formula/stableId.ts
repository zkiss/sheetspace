/** Decodes the fixed-width UTF-16 representation emitted for named stable IDs. */
export function decodeStableId(value: string): string | undefined {
  if (value.length === 0 || value.length % 4 !== 0) return undefined;
  let decoded = '';
  for (let index = 0; index < value.length; index += 4) decoded += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  return decoded;
}
