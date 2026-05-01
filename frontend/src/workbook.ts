export const WORKBOOK_SCHEMA_VERSION = 1;
export const DEFAULT_COLUMN_COUNT = 10;
export const DEFAULT_ROW_COUNT = 20;

export type Workbook = {
  version: typeof WORKBOOK_SCHEMA_VERSION;
  sheets: Sheet[];
};

export type Sheet = {
  id: string;
  name: string;
  position: WorkspacePosition;
  columnCount: number;
  rowCount: number;
  cells: Record<CellKey, CellContent>;
};

export type WorkspacePosition = {
  x: number;
  y: number;
};

export type CellContent = {
  raw: string;
};

export type CellKey = string;

export type CellAddress = {
  columnIndex: number;
  rowIndex: number;
};

export type CellRange = {
  start: CellAddress;
  end: CellAddress;
};

export type NamedCellReference = CellAddress & {
  sheetName?: string;
};

export type NamedRangeReference = CellRange & {
  sheetName?: string;
};

export type ValidationResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate' };

export type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'empty' | 'duplicate' | 'unknown-sheet' };

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid-format' | 'out-of-bounds' | 'unknown-sheet' };

export function createEmptyWorkbook(): Workbook {
  return {
    version: WORKBOOK_SCHEMA_VERSION,
    sheets: [],
  };
}

export function createSheet(input: {
  id: string;
  name: string;
  existingSheets?: Pick<Sheet, 'id' | 'name'>[];
  position?: WorkspacePosition;
}): MutationResult<Sheet> {
  const validation = validateSheetName(input.name, input.existingSheets ?? []);
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    value: {
      id: input.id,
      name: validation.name,
      position: input.position ?? { x: 0, y: 0 },
      columnCount: DEFAULT_COLUMN_COUNT,
      rowCount: DEFAULT_ROW_COUNT,
      cells: {},
    },
  };
}

export function validateSheetName(
  name: string,
  existingSheets: Pick<Sheet, 'id' | 'name'>[],
  currentSheetId?: string,
): ValidationResult {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const duplicate = existingSheets.some(
    (sheet) => sheet.id !== currentSheetId && sheet.name === trimmedName,
  );
  if (duplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  return { ok: true, name: trimmedName };
}

export function renameSheet(workbook: Workbook, sheetId: string, nextName: string): MutationResult<Workbook> {
  const validation = validateSheetName(nextName, workbook.sheets, sheetId);
  if (!validation.ok) {
    return validation;
  }

  if (!workbook.sheets.some((sheet) => sheet.id === sheetId)) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return {
    ok: true,
    value: {
      ...workbook,
      sheets: workbook.sheets.map((sheet) =>
        sheet.id === sheetId ? { ...sheet, name: validation.name } : sheet,
      ),
    },
  };
}

export function findSheetByName(workbook: Workbook, sheetName: string): ParseResult<Sheet> {
  const sheet = workbook.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    return { ok: false, reason: 'unknown-sheet' };
  }

  return { ok: true, value: sheet };
}

export function appendRow(sheet: Sheet): Sheet {
  return {
    ...sheet,
    rowCount: sheet.rowCount + 1,
  };
}

export function appendColumn(sheet: Sheet): Sheet {
  return {
    ...sheet,
    columnCount: sheet.columnCount + 1,
  };
}

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

export function columnLabelToIndex(columnLabel: string): ParseResult<number> {
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

export function parseA1Address(input: string, bounds?: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellAddress> {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(input.trim());
  if (!match) {
    return { ok: false, reason: 'invalid-format' };
  }

  const columnIndex = columnLabelToIndex(match[1]);
  if (!columnIndex.ok) {
    return columnIndex;
  }

  const rowIndex = Number.parseInt(match[2], 10) - 1;
  const address = { columnIndex: columnIndex.value, rowIndex };

  if (bounds && !isAddressWithinBounds(address, bounds)) {
    return { ok: false, reason: 'out-of-bounds' };
  }

  return { ok: true, value: address };
}

export function parseA1Range(input: string, bounds?: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellRange> {
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

  return {
    ok: true,
    value: normalizeRange({ start: start.value, end: end.value }),
  };
}

export function expandRange(range: CellRange, bounds: Pick<Sheet, 'columnCount' | 'rowCount'>): ParseResult<CellAddress[]> {
  const normalized = normalizeRange(range);
  if (
    !isAddressWithinBounds(normalized.start, bounds) ||
    !isAddressWithinBounds(normalized.end, bounds)
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

export function parseNamedA1Address(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedCellReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const address = parseA1Address(reference.value.reference, sheet.value);
  if (!address.ok) {
    return address;
  }

  return {
    ok: true,
    value: {
      ...address.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function parseNamedA1Range(
  input: string,
  workbook: Workbook,
  defaultSheet?: Sheet,
): ParseResult<NamedRangeReference> {
  const reference = splitSheetReference(input);
  if (!reference.ok) {
    return reference;
  }

  const sheet = resolveReferenceSheet(reference.value.sheetName, workbook, defaultSheet);
  if (!sheet.ok) {
    return sheet;
  }

  const range = parseA1Range(reference.value.reference, sheet.value);
  if (!range.ok) {
    return range;
  }

  return {
    ok: true,
    value: {
      ...range.value,
      sheetName: reference.value.sheetName,
    },
  };
}

export function isAddressWithinBounds(
  address: CellAddress,
  bounds: Pick<Sheet, 'columnCount' | 'rowCount'>,
): boolean {
  return (
    address.columnIndex >= 0 &&
    address.rowIndex >= 0 &&
    address.columnIndex < bounds.columnCount &&
    address.rowIndex < bounds.rowCount
  );
}

function normalizeRange(range: CellRange): CellRange {
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

function resolveReferenceSheet(
  sheetName: string | undefined,
  workbook: Workbook,
  defaultSheet: Sheet | undefined,
): ParseResult<Sheet> {
  if (!sheetName) {
    if (!defaultSheet) {
      return { ok: false, reason: 'unknown-sheet' };
    }
    return { ok: true, value: defaultSheet };
  }

  return findSheetByName(workbook, sheetName);
}

function splitSheetReference(
  input: string,
): ParseResult<{ sheetName?: string; reference: string }> {
  const trimmedInput = input.trim();
  if (trimmedInput.startsWith("'")) {
    const closingQuoteIndex = trimmedInput.indexOf("'!");
    if (closingQuoteIndex <= 1) {
      return { ok: false, reason: 'invalid-format' };
    }

    return {
      ok: true,
      value: {
        sheetName: trimmedInput.slice(1, closingQuoteIndex),
        reference: trimmedInput.slice(closingQuoteIndex + 2),
      },
    };
  }

  const separatorIndex = trimmedInput.indexOf('!');
  if (separatorIndex === -1) {
    return { ok: true, value: { reference: trimmedInput } };
  }

  if (separatorIndex === 0 || separatorIndex === trimmedInput.length - 1) {
    return { ok: false, reason: 'invalid-format' };
  }

  return {
    ok: true,
    value: {
      sheetName: trimmedInput.slice(0, separatorIndex).trim(),
      reference: trimmedInput.slice(separatorIndex + 1),
    },
  };
}
