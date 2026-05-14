ALTER TABLE sheets
ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0;

UPDATE sheets
SET z_index = display_order + 1;
