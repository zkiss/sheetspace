import type { CellKey, Sheet, SheetFrameSize, Workbook, WorkspacePosition } from './workbook';

type ApiErrorBody = {
  ok?: false;
  error?: string;
};

type MutationResponse = {
  ok: true;
  workbook: Workbook;
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

function mutationRequest(url: string, init?: RequestInit): Promise<Workbook> {
  return requestJson<MutationResponse>(url, init).then((response) => response.workbook);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export const workbookApi = {
  loadWorkbook(): Promise<Workbook> {
    return requestJson<Workbook>('/api/workbook');
  },

  createSheet(
    sheet: Pick<Sheet, 'name' | 'position'> & Partial<Pick<Sheet, 'frameSize' | 'zIndex'>>,
  ): Promise<Workbook> {
    const requestBody = {
      name: sheet.name,
      position: sheet.position,
      ...(sheet.frameSize === undefined ? {} : { frameSize: sheet.frameSize }),
      ...(sheet.zIndex === undefined ? {} : { zIndex: sheet.zIndex }),
    };

    return mutationRequest('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  },

  deleteSheet(sheetId: string, options: RevisionedMutationOptions = {}): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'DELETE',
      headers: revisionHeaders(options),
    });
  },

  renameSheet(sheetId: string, name: string, options: RevisionedMutationOptions = {}): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetPosition(
    sheetId: string,
    position: WorkspacePosition,
    options: RevisionedMutationOptions = {},
  ): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ position }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetFrameSize(
    sheetId: string,
    frameSize: SheetFrameSize,
    options: RevisionedMutationOptions = {},
  ): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ frameSize }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetZIndex(sheetId: string, zIndex: number, options: RevisionedMutationOptions = {}): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ zIndex }),
      headers: revisionHeaders(options),
    });
  },

  updateCellContent(
    sheetId: string,
    cellAddress: CellKey,
    raw: string,
    options: RevisionedMutationOptions = {},
  ): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/cells/${encodePathSegment(cellAddress)}`, {
      method: 'PUT',
      body: JSON.stringify({ raw }),
      headers: revisionHeaders(options),
    });
  },

  appendRow(sheetId: string, options: RevisionedMutationOptions = {}): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/rows`, {
      method: 'POST',
      headers: revisionHeaders(options),
    });
  },

  appendColumn(sheetId: string, options: RevisionedMutationOptions = {}): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/columns`, {
      method: 'POST',
      headers: revisionHeaders(options),
    });
  },
};

export type WorkbookApi = typeof workbookApi;

function revisionHeaders(options: RevisionedMutationOptions): HeadersInit {
  return options.revision === undefined ? {} : { 'If-Match': String(options.revision) };
}
