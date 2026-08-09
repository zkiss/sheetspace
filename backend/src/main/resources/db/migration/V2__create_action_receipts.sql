CREATE TABLE action_receipts (
    action_id TEXT PRIMARY KEY CHECK (length(action_id) > 0),
    request_fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL
);
