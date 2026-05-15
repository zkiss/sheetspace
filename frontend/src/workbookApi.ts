import type { CellKey, Sheet, Workbook, WorkspacePosition } from './workbook';

type ApiErrorBody = {
  ok?: false;
  error?: string;
};

type MutationResponse = {
  ok: true;
  workbook: Workbook;
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

  createSheet(sheet: Pick<Sheet, 'id' | 'name' | 'position'> & Partial<Pick<Sheet, 'zIndex'>>): Promise<Workbook> {
    const requestBody = {
      id: sheet.id,
      name: sheet.name,
      position: sheet.position,
      ...(sheet.zIndex === undefined ? {} : { zIndex: sheet.zIndex }),
    };

    return mutationRequest('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  },

  renameSheet(sheetId: string, name: string): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  updateSheetPosition(sheetId: string, position: WorkspacePosition): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ position }),
    });
  },

  updateSheetZIndex(sheetId: string, zIndex: number): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ zIndex }),
    });
  },

  updateCellContent(sheetId: string, cellAddress: CellKey, raw: string): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/cells/${encodePathSegment(cellAddress)}`, {
      method: 'PUT',
      body: JSON.stringify({ raw }),
    });
  },

  appendRow(sheetId: string): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/rows`, {
      method: 'POST',
    });
  },

  appendColumn(sheetId: string): Promise<Workbook> {
    return mutationRequest(`/api/sheets/${encodePathSegment(sheetId)}/columns`, {
      method: 'POST',
    });
  },
};

export type WorkbookApi = typeof workbookApi;
