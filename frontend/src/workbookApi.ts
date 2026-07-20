import type { CellKey, Sheet, SheetFrameSize, Workbook, WorkspacePosition } from './workbook';

type ApiErrorBody = {
  error?: string;
};

type WorkbookSummary = {
  version: Workbook['version'];
  sheetIds: string[];
};

export type SheetRevisionResponse = {
  sheetId: string;
  revision: number;
};

export type RowAppendResponse = SheetRevisionResponse & {
  rowCount: number;
};

export type ColumnAppendResponse = SheetRevisionResponse & {
  columnCount: number;
};

export type RevisionedMutationOptions = {
  revision?: number;
};

export class WorkbookApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WorkbookApiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | undefined;
    const code = typeof errorBody?.error === 'string' ? errorBody.error : undefined;
    throw new WorkbookApiError(code ?? `Workbook request failed with status ${response.status}.`, response.status, code);
  }

  return payload as T;
}

async function requestVoid(url: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const errorBody = payload as ApiErrorBody | undefined;
    const code = typeof errorBody?.error === 'string' ? errorBody.error : undefined;
    throw new WorkbookApiError(code ?? `Workbook request failed with status ${response.status}.`, response.status, code);
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export const workbookApi = {
  loadWorkbook(): Promise<Workbook> {
    return requestJson<WorkbookSummary>('/api/workbook').then(async (summary) => ({
      version: summary.version,
      sheets: await Promise.all(
        summary.sheetIds.map((sheetId) => requestJson<Sheet>(`/api/sheets/${encodePathSegment(sheetId)}`)),
      ),
    }));
  },

  loadSheet(sheetId: string): Promise<Sheet> {
    return requestJson<Sheet>(`/api/sheets/${encodePathSegment(sheetId)}`);
  },

  createSheet(
    sheet: Pick<Sheet, 'name' | 'position'> & Partial<Pick<Sheet, 'frameSize' | 'zIndex'>>,
  ): Promise<Sheet> {
    const requestBody = {
      name: sheet.name,
      position: sheet.position,
      ...(sheet.frameSize === undefined ? {} : { frameSize: sheet.frameSize }),
      ...(sheet.zIndex === undefined ? {} : { zIndex: sheet.zIndex }),
    };

    return requestJson<Sheet>('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  },

  deleteSheet(sheetId: string, options: RevisionedMutationOptions = {}): Promise<void> {
    return requestVoid(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'DELETE',
      headers: revisionHeaders(options),
    });
  },

  renameSheet(sheetId: string, name: string, options: RevisionedMutationOptions = {}): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetPosition(
    sheetId: string,
    position: WorkspacePosition,
    options: RevisionedMutationOptions = {},
  ): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ position }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetFrameSize(
    sheetId: string,
    frameSize: SheetFrameSize,
    options: RevisionedMutationOptions = {},
  ): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ frameSize }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetZIndex(sheetId: string, zIndex: number, options: RevisionedMutationOptions = {}): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ zIndex }),
      headers: revisionHeaders(options),
    });
  },

  updateCellContent(
    sheetId: string,
    cellAddress: CellKey,
    content: string,
    options: RevisionedMutationOptions = {},
  ): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}/cells/${encodePathSegment(cellAddress)}`, {
      method: 'PUT',
      body: JSON.stringify(content),
      headers: revisionHeaders(options),
    });
  },

  appendRow(sheetId: string, options: RevisionedMutationOptions = {}): Promise<RowAppendResponse> {
    return requestJson<RowAppendResponse>(`/api/sheets/${encodePathSegment(sheetId)}/rows`, {
      method: 'POST',
      headers: revisionHeaders(options),
    });
  },

  appendColumn(sheetId: string, options: RevisionedMutationOptions = {}): Promise<ColumnAppendResponse> {
    return requestJson<ColumnAppendResponse>(`/api/sheets/${encodePathSegment(sheetId)}/columns`, {
      method: 'POST',
      headers: revisionHeaders(options),
    });
  },
};

export type WorkbookApi = typeof workbookApi;

function revisionHeaders(options: RevisionedMutationOptions): HeadersInit {
  return options.revision === undefined ? {} : { 'If-Match': String(options.revision) };
}
