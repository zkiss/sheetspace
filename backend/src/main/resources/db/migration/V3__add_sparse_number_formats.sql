CREATE TABLE row_format_presentation (
    sheet_id BLOB NOT NULL,
    row_id BLOB NOT NULL,
    format_kind TEXT NOT NULL CHECK (format_kind IN ('general', 'number', 'percent')),
    precision INTEGER CHECK (precision IS NULL OR (precision >= 0 AND precision <= 10)),
    PRIMARY KEY (sheet_id, row_id),
    FOREIGN KEY (sheet_id, row_id) REFERENCES sheet_rows(sheet_id, row_id) ON DELETE CASCADE
);
CREATE TABLE column_format_presentation (
    sheet_id BLOB NOT NULL,
    column_id BLOB NOT NULL,
    format_kind TEXT NOT NULL CHECK (format_kind IN ('general', 'number', 'percent')),
    precision INTEGER CHECK (precision IS NULL OR (precision >= 0 AND precision <= 10)),
    PRIMARY KEY (sheet_id, column_id),
    FOREIGN KEY (sheet_id, column_id) REFERENCES sheet_columns(sheet_id, column_id) ON DELETE CASCADE
);
CREATE TABLE cell_format_presentation (
    sheet_id BLOB NOT NULL,
    cell_key TEXT NOT NULL,
    format_kind TEXT NOT NULL CHECK (format_kind IN ('general', 'number', 'percent')),
    precision INTEGER CHECK (precision IS NULL OR (precision >= 0 AND precision <= 10)),
    PRIMARY KEY (sheet_id, cell_key),
    FOREIGN KEY (sheet_id) REFERENCES sheet_documents(id) ON DELETE CASCADE
);
