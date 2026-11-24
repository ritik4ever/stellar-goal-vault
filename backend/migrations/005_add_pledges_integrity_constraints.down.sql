-- Rollback 005_add_pledges_integrity_constraints.

DROP TRIGGER IF EXISTS pledges_persistence_integrity_update;
DROP TRIGGER IF EXISTS pledges_persistence_integrity_insert;
