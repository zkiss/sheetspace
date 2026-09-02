export type CellKey = string;

export type CellAddress = {
  columnIndex: number;
  rowIndex: number;
};

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

export type AddressBounds = {
  columnCount: number;
  rowCount: number;
};

export type AddressParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid-format' | 'out-of-bounds' };

export function columnIndexToLabel(columnIndex: number): string {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    throw new RangeError('Column index must be a non-negative integer.');
  }

  let remaining = columnIndex + 1;
  let label = '';
  while (remaining > 0) {
    const letterOffset = (remaining - 1) % 26;
    label = String.fromCharCode(65 + letterOffset) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }

  return label;
}

export function columnLabelToIndex(columnLabel: string): AddressParseResult<number> {
  if (!/^[A-Za-z]+$/.test(columnLabel)) {
    return { ok: false, reason: 'invalid-format' };
  }

  let index = 0;
  for (const letter of columnLabel.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }

  return { ok: true, value: index - 1 };
}

export function cellKey(address: CellAddress): CellKey {
  return `${columnIndexToLabel(address.columnIndex)}${address.rowIndex + 1}`;
}

export function parseA1Address(
  input: string,
  bounds?: AddressBounds,
): AddressParseResult<CellAddress> {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(input.trim());
  if (!match) {
    return { ok: false, reason: 'invalid-format' };
  }

  const columnIndex = columnLabelToIndex(match[1]);
  if (!columnIndex.ok) {
    return columnIndex;
  }

  const address = {
    columnIndex: columnIndex.value,
    rowIndex: Number.parseInt(match[2], 10) - 1,
  };
  return bounds && !isAddressWithinBounds(address, bounds)
    ? { ok: false, reason: 'out-of-bounds' }
    : { ok: true, value: address };
}

export function parseA1Range(
  input: string,
  bounds?: AddressBounds,
): AddressParseResult<CellRange> {
  const parts = input.split(':');
  if (parts.length !== 2) {
    return { ok: false, reason: 'invalid-format' };
  }

  const start = parseA1Address(parts[0], bounds);
  if (!start.ok) {
    return start;
  }
  const end = parseA1Address(parts[1], bounds);
  if (!end.ok) {
    return end;
  }

  return { ok: true, value: normalizeRange({ start: start.value, end: end.value }) };
}

export function expandRange(
  range: CellRange,
  bounds: AddressBounds,
): AddressParseResult<CellAddress[]> {
  const normalized = normalizeRange(range);
  if (
    !isAddressWithinBounds(normalized.start, bounds)
    || !isAddressWithinBounds(normalized.end, bounds)
  ) {
    return { ok: false, reason: 'out-of-bounds' };
  }

  const addresses: CellAddress[] = [];
  for (let rowIndex = normalized.start.rowIndex; rowIndex <= normalized.end.rowIndex; rowIndex += 1) {
    for (
      let columnIndex = normalized.start.columnIndex;
      columnIndex <= normalized.end.columnIndex;
      columnIndex += 1
    ) {
      addresses.push({ columnIndex, rowIndex });
    }
  }
  return { ok: true, value: addresses };
}

export function isAddressWithinBounds(address: CellAddress, bounds: AddressBounds): boolean {
  return (
    address.columnIndex >= 0
    && address.rowIndex >= 0
    && address.columnIndex < bounds.columnCount
    && address.rowIndex < bounds.rowCount
  );
}

export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      columnIndex: Math.min(range.start.columnIndex, range.end.columnIndex),
      rowIndex: Math.min(range.start.rowIndex, range.end.rowIndex),
    },
    end: {
      columnIndex: Math.max(range.start.columnIndex, range.end.columnIndex),
      rowIndex: Math.max(range.start.rowIndex, range.end.rowIndex),
    },
  };
}
