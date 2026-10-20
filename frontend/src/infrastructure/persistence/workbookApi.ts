import type { AxisSizeWrite, DataModel, ModelColumnType, FormatWrite, SheetPresentation } from '@workbook/core/model';
import { isValidCellAppearance, validFormatWrites } from '@workbook/core/numberFormat';
import { validAxisSizeWrites } from '@workbook/core/axisSizePolicy';
import { isValidSheetVisualScale, WORKBOOK_SCHEMA_VERSION, type SheetDocument, type SheetFrameSize, type Workbook, type WorkbookManifest, type WorkspacePosition } from '@workbook/core/model';
import { cellIdentityKey } from '@workbook/core/cellIdentity';

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
    visualScale: number;
    zIndex: number;
  };
  presentation: SheetPresentation;
  content: {
    kind: 'tabular';
    rows: string[];
    columns: string[];
    cells: CellContentResponse[];
  };
  modelId?: string;
  modelColumnBindings?: Record<string, string>;
};

export type WorkbookBundleResponse = {
  manifest: WorkbookManifestResponse;
  documents: SheetDocumentResponse[];
  dataModels: DataModelResponse[];
};

export type DataModelResponse = { id: string; name: string; columns: ModelColumnResponse[] };
export type ModelColumnResponse = { id: string; name: string; kind: 'manual' | 'calculated'; type: ModelColumnType; formula?: string };

export type SheetRevisionResponse = {
  sheetId: string;
  revision: number;
};

export type CellPatchWrite = {
  sheetId: string;
  rowId: string;
  columnId: string;
  raw: string;
};

export type CellPatchResponse = {
  sheets: SheetRevisionResponse[];
};

export type RowAppendResponse = SheetRevisionResponse & {
  rowCount: number;
  rowId: string;
};

export type ColumnAppendResponse = SheetRevisionResponse & {
  columnCount: number;
  columnId: string;
};

export type SheetZOrderUpdate = {
  sheetId: string;
  expectedRevision: number;
  zIndex: number;
};

export type UpdateSheetZOrderResponse = {
  sheets: SheetRevisionResponse[];
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
  writeAxisSizes(sheetId: string, writes: readonly AxisSizeWrite[], options: RevisionedMutationOptions = {}): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}/presentation`, {
      method: 'PATCH', body: JSON.stringify({ writes }), headers: revisionHeaders(options),
    });
  },
  writeNumberFormats(sheetId: string, writes: readonly FormatWrite[], options: RevisionedMutationOptions = {}): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}/presentation`, {
      method: 'PATCH', body: JSON.stringify({ formatWrites: writes }), headers: revisionHeaders(options),
    });
  },

  loadWorkbook(): Promise<Workbook> {
    return requestJson<WorkbookBundleResponse>('/api/workbook/bundle').then(decodeWorkbookBundle);
  },

  loadSheet(sheetId: string): Promise<SheetDocument> {
    return requestJson<SheetDocumentResponse>(`/api/sheets/${encodePathSegment(sheetId)}`).then(decodeSheetDocument);
  },

  createSheet(
    sheet: { name: string; position: WorkspacePosition; frameSize?: SheetFrameSize; visualScale?: number; zIndex?: number },
  ): Promise<SheetDocument> {
    const requestBody = {
      name: sheet.name,
      position: sheet.position,
      ...(sheet.frameSize === undefined ? {} : { frameSize: sheet.frameSize }),
      ...(sheet.visualScale === undefined ? {} : { visualScale: sheet.visualScale }),
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

  updateSheetFrameLayout(
    sheetId: string,
    position: WorkspacePosition,
    frameSize: SheetFrameSize,
    options: RevisionedMutationOptions = {},
  ): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ position, frameSize }),
      headers: revisionHeaders(options),
    });
  },

  updateSheetVisualScale(
    sheetId: string,
    visualScale: number,
    options: RevisionedMutationOptions = {},
  ): Promise<SheetRevisionResponse> {
    return requestJson<SheetRevisionResponse>(`/api/sheets/${encodePathSegment(sheetId)}`, {
      method: 'PATCH', body: JSON.stringify({ visualScale }), headers: revisionHeaders(options),
    });
  },

  updateSheetZOrder(updates: SheetZOrderUpdate[]): Promise<UpdateSheetZOrderResponse> {
    return requestJson<UpdateSheetZOrderResponse>('/api/workbook/sheet-z-order', {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    });
  },

  writeCells(
    expectedRevisions: readonly { sheetId: string; revision: number }[],
    cells: readonly CellPatchWrite[],
  ): Promise<CellPatchResponse> {
    return requestJson<CellPatchResponse>('/api/cells', {
      method: 'PATCH',
      body: JSON.stringify({ expectedRevisions, cells }),
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

  saveDataModel(model: DataModel): Promise<DataModel> {
    const request = { name: model.name, columns: model.columns };
    return requestJson<DataModelResponse>(`/api/data-models/${encodePathSegment(model.id)}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }).then(decodeDataModel);
  },

  setSheetModel(sheetId: string, modelId?: string, modelColumnBindings?: Readonly<Record<string, string>>): Promise<SheetDocument> {
    return requestJson<SheetDocumentResponse>(`/api/sheets/${encodePathSegment(sheetId)}/model`, {
      method: 'PUT',
      body: JSON.stringify({ modelId: modelId ?? null, ...(modelColumnBindings === undefined ? {} : { modelColumnBindings }) }),
    }).then(decodeSheetDocument);
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
  if (new Set(bundle.dataModels.map((model) => model.id)).size !== bundle.dataModels.length) {
    invalidReadContract('duplicate data model id');
  }
  const dataModels = Object.fromEntries(bundle.dataModels.map((model) => [model.id, decodeDataModel(model)]));
  for (const document of decodedDocuments) {
    if (document.modelId !== undefined && !Object.prototype.hasOwnProperty.call(dataModels, document.modelId)) {
      invalidReadContract(`sheet ${document.id} references unknown data model ${document.modelId}`);
    }
    const bindings = document.modelColumnBindings ?? {};
    const model = document.modelId === undefined ? undefined : dataModels[document.modelId];
    if (Object.keys(bindings).some((propertyId) => !model?.columns.some((property) => property.id === propertyId))) {
      invalidReadContract(`invalid model column bindings for sheet ${document.id}`);
    }
  }

  return {
    manifest,
    documents: Object.fromEntries(decodedDocuments.map((document) => [document.id, document])),
    dataModels,
  };
}

export function decodeSheetDocument(document: SheetDocumentResponse): SheetDocument {
  if (document.content.kind !== 'tabular') invalidReadContract(`unsupported sheet content ${document.content.kind}`);
  const rowIndices = uniqueIndices(document.content.rows, 'row');
  const columnIndices = uniqueIndices(document.content.columns, 'column');
  const cells: Record<string, string> = {};

  if (document.modelColumnBindings !== undefined && (!document.modelColumnBindings || Array.isArray(document.modelColumnBindings)
      || typeof document.modelColumnBindings !== 'object'
      || Object.entries(document.modelColumnBindings).some(([propertyId, columnId]) => !propertyId || typeof columnId !== 'string' || !columnId)
      || (document.modelId === undefined && Object.keys(document.modelColumnBindings).length > 0)
      || Object.values(document.modelColumnBindings).some((columnId) => !columnIndices.has(columnId))
      || new Set(Object.values(document.modelColumnBindings)).size !== Object.keys(document.modelColumnBindings).length)) {
    invalidReadContract('invalid model column bindings');
  }

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

  const presentation = document.presentation;
  if (!presentation || !presentation.rowHeights || !presentation.columnWidths
      || Array.isArray(presentation.rowHeights) || Array.isArray(presentation.columnWidths)
      || typeof presentation.rowHeights !== 'object' || typeof presentation.columnWidths !== 'object') {
    invalidReadContract('missing or malformed sheet presentation');
  }
  const overrides: AxisSizeWrite[] = [
    ...Object.entries(presentation.rowHeights).map(([axisId, size]) => ({ axis: 'row' as const, axisId, size })),
    ...Object.entries(presentation.columnWidths).map(([axisId, size]) => ({ axis: 'column' as const, axisId, size })),
  ];
  if (overrides.some((write) => typeof write.size !== 'number')
      || (overrides.length > 0 && !validAxisSizeWrites({ ...document.content, cells: {} }, overrides))) {
    invalidReadContract('invalid sheet presentation override');
  }
  if (!document.frame || !isValidSheetVisualScale(document.frame.visualScale)) {
    invalidReadContract('invalid sheet visual scale');
  }

  const formats = presentation.formatOverrides;
  if (formats !== undefined && (!formats || ['rows', 'columns', 'cells'].some((scope) => !formats[scope as keyof typeof formats] || typeof formats[scope as keyof typeof formats] !== 'object' || Array.isArray(formats[scope as keyof typeof formats]))
      || Object.values(formats.rows).some((format) => !isValidCellAppearance(format))
      || Object.values(formats.columns).some((format) => !isValidCellAppearance(format))
      || Object.values(formats.cells).some((format) => !isValidCellAppearance(format)))) invalidReadContract('invalid appearance overrides');
  if (formats !== undefined) {
    const formatWrites = [
      ...Object.entries(formats.rows).map(([targetId, properties]) => ({ scope: 'row' as const, targetId, properties })),
      ...Object.entries(formats.columns).map(([targetId, properties]) => ({ scope: 'column' as const, targetId, properties })),
      ...Object.entries(formats.cells).map(([targetId, properties]) => ({ scope: 'cell' as const, targetId, properties })),
    ];
    if (formatWrites.length > 0 && !validFormatWrites(document.content, formatWrites)) invalidReadContract('invalid number format overrides');
  }
  return {
    presentation: { rowHeights: { ...presentation.rowHeights }, columnWidths: { ...presentation.columnWidths }, ...(formats === undefined ? {} : { formatOverrides: { rows: { ...formats.rows }, columns: { ...formats.columns }, cells: { ...formats.cells } } }) },
    id: document.id,
    name: document.name,
    revision: document.revision,
    frame: {
      position: { ...document.frame.position },
      size: { ...document.frame.size },
      visualScale: document.frame.visualScale,
      zIndex: document.frame.zIndex,
    },
    content: {
      kind: 'tabular',
      rows: [...document.content.rows],
      columns: [...document.content.columns],
      cells,
    },
    ...(document.modelId === undefined ? {} : { modelId: document.modelId }),
    ...(document.modelColumnBindings === undefined ? {} : { modelColumnBindings: { ...document.modelColumnBindings } }),
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

export function decodeDataModel(model: DataModelResponse): DataModel {
  if (!model.id.trim() || !model.name.trim() || new Set(model.columns.map((column) => column.id)).size !== model.columns.length || new Set(model.columns.map((column) => column.name.trim())).size !== model.columns.length) invalidReadContract('invalid model declaration');
  const columns = model.columns.map((column) => {
    if (!column.id.trim() || !column.name.trim() || !['string', 'int', 'float', 'boolean'].includes(column.type)) invalidReadContract('invalid model column');
    if (column.kind === 'manual' && column.formula === undefined) return { id: column.id, name: column.name, kind: 'manual' as const, type: column.type };
    if (column.kind === 'calculated' && typeof column.formula === 'string' && column.formula.trim()) return { id: column.id, name: column.name, kind: 'calculated' as const, type: column.type, formula: column.formula };
    invalidReadContract('invalid model formula');
  });
  return { id: model.id, name: model.name, columns };
}
