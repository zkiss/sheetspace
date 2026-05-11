CREATE TABLE workbook_metadata (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    schema_version INTEGER NOT NULL
);

INSERT INTO workbook_metadata (singleton_key, schema_version)
VALUES (1, 1);

CREATE TABLE sheets (
    id TEXT PRIMARY KEY,
    display_order INTEGER NOT NULL,
    name TEXT NOT NULL UNIQUE,
    row_count INTEGER NOT NULL,
    column_count INTEGER NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    cells_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0
);
