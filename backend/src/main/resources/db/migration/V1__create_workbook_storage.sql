CREATE TABLE workbook_metadata (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    schema_version INTEGER NOT NULL,
    manifest_revision INTEGER NOT NULL DEFAULT 0 CHECK (manifest_revision >= 0)
);

INSERT INTO workbook_metadata (singleton_key, schema_version, manifest_revision)
VALUES (1, 1, 0);

CREATE TABLE sheet_documents (
    id BLOB PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16),
    name TEXT NOT NULL UNIQUE,
    content_kind TEXT NOT NULL CHECK (content_kind = 'TABULAR'),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE workbook_sheets (
    sheet_id BLOB PRIMARY KEY,
    sheet_order INTEGER NOT NULL UNIQUE CHECK (sheet_order >= 0),
    FOREIGN KEY (sheet_id) REFERENCES sheet_documents(id) ON DELETE CASCADE
);

CREATE TABLE frame_state (
    sheet_id BLOB PRIMARY KEY,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    frame_width REAL NOT NULL CHECK (frame_width > 0),
    frame_height REAL NOT NULL CHECK (frame_height > 0),
    z_index INTEGER NOT NULL CHECK (z_index >= 1),
    FOREIGN KEY (sheet_id) REFERENCES sheet_documents(id) ON DELETE CASCADE
);

CREATE TABLE sheet_rows (
    sheet_id BLOB NOT NULL,
    row_id BLOB NOT NULL CHECK (typeof(row_id) = 'blob' AND length(row_id) = 16),
    row_order INTEGER NOT NULL CHECK (row_order >= 0),
    PRIMARY KEY (sheet_id, row_id),
    UNIQUE (sheet_id, row_order),
    FOREIGN KEY (sheet_id) REFERENCES sheet_documents(id) ON DELETE CASCADE
);

CREATE TABLE sheet_columns (
    sheet_id BLOB NOT NULL,
    column_id BLOB NOT NULL CHECK (typeof(column_id) = 'blob' AND length(column_id) = 16),
    column_order INTEGER NOT NULL CHECK (column_order >= 0),
    PRIMARY KEY (sheet_id, column_id),
    UNIQUE (sheet_id, column_order),
    FOREIGN KEY (sheet_id) REFERENCES sheet_documents(id) ON DELETE CASCADE
);

CREATE TABLE cells (
    sheet_id BLOB NOT NULL,
    row_id BLOB NOT NULL,
    column_id BLOB NOT NULL,
    raw_content TEXT NOT NULL CHECK (raw_content <> ''),
    PRIMARY KEY (sheet_id, row_id, column_id),
    FOREIGN KEY (sheet_id, row_id) REFERENCES sheet_rows(sheet_id, row_id) ON DELETE CASCADE,
    FOREIGN KEY (sheet_id, column_id) REFERENCES sheet_columns(sheet_id, column_id) ON DELETE CASCADE
);
