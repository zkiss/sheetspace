CREATE TABLE sheets_without_display_order (
    id BLOB PRIMARY KEY CHECK(typeof(id) = 'blob' AND length(id) = 16),
    name TEXT NOT NULL UNIQUE,
    row_count INTEGER NOT NULL,
    column_count INTEGER NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    cells_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    z_index INTEGER NOT NULL DEFAULT 0,
    frame_width REAL NOT NULL DEFAULT 240.0,
    frame_height REAL NOT NULL DEFAULT 160.0
);

INSERT INTO sheets_without_display_order (
    id, name, row_count, column_count, position_x, position_y,
    cells_json, revision, z_index, frame_width, frame_height
)
SELECT
    id, name, row_count, column_count, position_x, position_y,
    cells_json, revision, z_index, frame_width, frame_height
FROM sheets;

DROP TABLE sheets;

ALTER TABLE sheets_without_display_order RENAME TO sheets;
