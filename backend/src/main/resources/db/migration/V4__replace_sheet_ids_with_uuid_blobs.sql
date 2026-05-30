-- Sheet ids are now backend-owned UUIDs. Existing sheets predate that
-- identity contract, so this migration intentionally discards them.
DROP TABLE sheets;

CREATE TABLE sheets (
    id BLOB PRIMARY KEY CHECK(typeof(id) = 'blob' AND length(id) = 16),
    display_order INTEGER NOT NULL,
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
