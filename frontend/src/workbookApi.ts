import {
  WORKBOOK_SCHEMA_VERSION,
  cellIdentityKey,
  type CellKey,
  type SheetDocument,
  type SheetFrameSize,
  type Workbook,
  type WorkbookManifest,
  type WorkspacePosition,
} from './workbook';

type ApiErrorBody = {
  error?: string;
};

export type WorkbookManifestResponse = {
  version: number;
  revision: number;
  sheetIds: string[];
};

export type CellContentResponse = {
  rowId: string;
  columnId: string;
  content: string;
};

export type SheetDocumentResponse = {
  id: string;
  revision: number;
  name: string;
  frame: {
    position: WorkspacePosition;
    size: SheetFrameSize;
    zIndex: number;
  };
  content: {
    kind: 'tabular';
    rows: string[];
    columns: string[];
    cells: CellContentResponse[];
  };
};

export type WorkbookBundleResponse = {
  manifest: WorkbookManifestResponse;
  documents: SheetDocumentResponse[];
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
    return requestJson<WorkbookBundleResponse>('/api/workbook/bundle').then(decodeWorkbookBundle);
  },

  loadSheet(sheetId: string): Promise<SheetDocument> {
    return requestJson<SheetDocumentResponse>(`/api/sheets/${encodePathSegment(sheetId)}`).then(decodeSheetDocument);
  },

  createSheet(
    sheet: { name: string; position: WorkspacePosition; frameSize?: SheetFrameSize; zIndex?: number },
  ): Promise<SheetDocument> {
    const requestBody = {
      name: sheet.name,
      position: sheet.position,
      ...(sheet.frameSize === undefined ? {} : { frameSize: sheet.frameSize }),
      ...(sheet.zIndex === undefined ? {} : { zIndex: sheet.zIndex }),
    };

    return requestJson<SheetDocumentResponse>('/api/sheets', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    }).then(decodeSheetDocument);
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

export function decodeWorkbookBundle(bundle: WorkbookBundleResponse): Workbook {
  const documents = new Map<string, SheetDocumentResponse>();
  for (const document of bundle.documents) {
    if (documents.has(document.id)) invalidReadContract(`duplicate sheet document ${document.id}`);
    documents.set(document.id, document);
  }

  if (new Set(bundle.manifest.sheetIds).size !== bundle.manifest.sheetIds.length) {
    invalidReadContract('duplicate manifest sheet id');
  }
  if (documents.size !== bundle.manifest.sheetIds.length) {
    invalidReadContract('manifest membership does not match sheet documents');
  }

  if (bundle.manifest.version !== WORKBOOK_SCHEMA_VERSION) {
    invalidReadContract(`unsupported workbook version ${bundle.manifest.version}`);
  }
  const manifest: WorkbookManifest = {
    version: WORKBOOK_SCHEMA_VERSION,
    revision: bundle.manifest.revision,
    sheetIds: [...bundle.manifest.sheetIds],
  };
  const decodedDocuments = bundle.manifest.sheetIds.map((sheetId) => {
      const document = documents.get(sheetId);
      if (!document) invalidReadContract(`missing sheet document ${sheetId}`);
      return decodeSheetDocument(document);
    });
  return {
    manifest,
    documents: Object.fromEntries(decodedDocuments.map((document) => [document.id, document])),
  };
}

export function decodeSheetDocument(document: SheetDocumentResponse): SheetDocument {
  if (document.content.kind !== 'tabular') invalidReadContract(`unsupported sheet content ${document.content.kind}`);
  const rowIndices = uniqueIndices(document.content.rows, 'row');
  const columnIndices = uniqueIndices(document.content.columns, 'column');
  const cells: Record<string, string> = {};

  for (const cell of document.content.cells) {
    const rowIndex = rowIndices.get(cell.rowId);
    const columnIndex = columnIndices.get(cell.columnId);
    if (rowIndex === undefined || columnIndex === undefined) {
      invalidReadContract(`cell coordinate does not belong to sheet ${document.id}`);
    }
    const identityKey = cellIdentityKey({ rowId: cell.rowId, columnId: cell.columnId });
    if (Object.prototype.hasOwnProperty.call(cells, identityKey)) {
      invalidReadContract(`duplicate cell coordinate ${cell.rowId}/${cell.columnId}`);
    }
    cells[identityKey] = cell.content;
  }

  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    frame: {
      position: { ...document.frame.position },
      size: { ...document.frame.size },
      zIndex: document.frame.zIndex,
    },
    content: {
      kind: 'tabular',
      rows: [...document.content.rows],
      columns: [...document.content.columns],
      cells,
    },
  };
}

function uniqueIndices(ids: string[], label: string): Map<string, number> {
  const indices = new Map(ids.map((id, index) => [id, index]));
  if (indices.size !== ids.length) invalidReadContract(`duplicate ${label} id`);
  return indices;
}

function invalidReadContract(detail: string): never {
  throw new WorkbookApiError(`Invalid workbook read contract: ${detail}.`, undefined, 'invalid-workbook-read-contract');
}
