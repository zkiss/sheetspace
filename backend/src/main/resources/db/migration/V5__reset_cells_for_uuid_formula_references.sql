-- Formula persistence now records sheet-qualified references by UUID.
-- Existing cell JSON predates that contract, so this migration intentionally
-- discards sheets rather than retaining name-based formula references.
DELETE FROM sheets;
