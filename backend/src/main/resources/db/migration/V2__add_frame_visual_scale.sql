ALTER TABLE frame_state
ADD COLUMN visual_scale REAL NOT NULL DEFAULT 1.0
CHECK (visual_scale >= 0.1 AND visual_scale <= 8.0);
